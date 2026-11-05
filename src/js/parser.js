    const FORMAT_SIZES = {
      a: 64, b: 1, B: 1, h: 2, H: 2, i: 4, I: 4, f: 4, d: 8,
      n: 4, N: 16, Z: 64, c: 2, C: 2, e: 4, E: 4, L: 4, M: 1, q: 8, Q: 8
    };

    function calcFormatPayloadSize(fmtStr) {
      let s = 0;
      for (let i = 0; i < fmtStr.length; i++) {
        const sz = FORMAT_SIZES[fmtStr[i]];
        if (!sz) return -1;
        s += sz;
      }
      return s;
    }

    function readCleanAscii(u8, start, len) {
      let s = '';
      for (let i = 0; i < len; i++) {
        const ch = u8[start + i];
        if (ch === 0) break;
        if (ch >= 32 && ch <= 126) s += String.fromCharCode(ch);
      }
      return s.trim();
    }

    function parseDataFlashBinary(uint8Array, fileName = 'uploaded.bin') {
      const dv = new DataView(uint8Array.buffer, uint8Array.byteOffset, uint8Array.byteLength);
      const len = uint8Array.byteLength;
      const fmtMap = {};
      const schemaDefinitions=new Map();
      const tables = {};
      const rawCounts = {};
      const typePacketCounts = new Int32Array(256);

      fmtMap[128] = {
        typeId: 128,
        length: 89,
        name: 'FMT',
        format: 'BBnNZ',
        columns: ['Type', 'Length', 'Name', 'Format', 'Columns'],
        count: 0
      };

      // PASS 1: Ultra-fast zero-allocation scan to extract FMT schemas and exact packet counts per message type.
      // Scanning 50MB in a typed array takes ~4ms and prevents allocating millions of temporary JS objects.
      let offset = 0;
      let totalPackets = 0;

      while (offset < len - 3) {
        if (uint8Array[offset] !== 0xA3 || uint8Array[offset + 1] !== 0x95) {
          offset++;
          continue;
        }
        const msgType = uint8Array[offset + 2];

        if (msgType === 0x80) {
          if (offset + 89 > len) break;
          const defType = uint8Array[offset + 3];
          const defLen = uint8Array[offset + 4];
          const defName = readCleanAscii(uint8Array, offset + 5, 4);
          const defFormat = readCleanAscii(uint8Array, offset + 9, 16);
          const defColsRaw = readCleanAscii(uint8Array, offset + 25, 64);
          const payloadSz = calcFormatPayloadSize(defFormat);

          if (
            /^[A-Za-z0-9_]{1,4}$/.test(defName) &&
            payloadSz >= 0 &&
            defLen >= 3 &&
            (defLen === 3 + payloadSz || defName === 'FMT')
          ) {
            const defCols = defColsRaw ? defColsRaw.split(',').map(s => s.trim()) : [];
            fmtMap[defType] = {
              typeId: defType,
              length: 3 + payloadSz,
              name: defName,
              format: defFormat,
              columns: defCols,
              count: 0,
              stride: 1,
              seen: 0
            };
            schemaDefinitions.set(offset,fmtMap[defType]);
            if (!tables[defName]) tables[defName] = [];
            if (rawCounts[defName] === undefined) rawCounts[defName] = 0;
            fmtMap[128].count++;
            totalPackets++;
            offset += 89;
            continue;
          } else {
            offset += 2;
            continue;
          }
        }

        const schema = fmtMap[msgType];
        if (!schema || schema.length < 3) {
          offset += 2;
          continue;
        }
        if (offset + schema.length > len) break;

        typePacketCounts[msgType]++;
        totalPackets++;
        offset += schema.length;
      }

      // Analysis/export retain every packet. Only chart rendering reduces points.
      for (const tId of Object.keys(fmtMap)) {
        const sc = fmtMap[tId];
        if (!sc || sc.typeId === 128) continue;
        const cnt = typePacketCounts[sc.typeId] || 0;
        sc.count = cnt;
        rawCounts[sc.name] = (rawCounts[sc.name] || 0) + cnt;
      }

      // PASS 2: Decode all packets, including brief spikes between display samples.
      offset = 0;
      const activeSchemas={128:fmtMap[128]};
      while (offset < len - 3) {
        if (uint8Array[offset] !== 0xA3 || uint8Array[offset + 1] !== 0x95) {
          offset++;
          continue;
        }
        const msgType = uint8Array[offset + 2];
        if (msgType === 0x80) {
          if (offset + 89 > len) break;
          const definition=schemaDefinitions.get(offset);
          if(definition)activeSchemas[definition.typeId]=definition;
          offset += 89;
          continue;
        }

        const schema = activeSchemas[msgType];
        if (!schema || schema.length < 3) {
          offset += 2;
          continue;
        }
        if (offset + schema.length > len) break;


        let fPos = offset + 3;
        const row = {};
        const fmtStr = schema.format;
        const cols = schema.columns;
        let validRow = true;

        for (let i = 0; i < fmtStr.length; i++) {
          const fChar = fmtStr[i];
          const colName = cols[i] || ('F' + i);
          const fSize = FORMAT_SIZES[fChar] || 0;
          if (fPos + fSize > offset + schema.length) {
            validRow = false;
            break;
          }
          switch (fChar) {
            case 'b': row[colName] = dv.getInt8(fPos); break;
            case 'B':
            case 'M': row[colName] = dv.getUint8(fPos); break;
            case 'h': row[colName] = dv.getInt16(fPos, true); break;
            case 'H': row[colName] = dv.getUint16(fPos, true); break;
            case 'c': row[colName] = dv.getInt16(fPos, true) / 100.0; break;
            case 'C': row[colName] = dv.getUint16(fPos, true) / 100.0; break;
            case 'i': row[colName] = dv.getInt32(fPos, true); break;
            case 'I': row[colName] = dv.getUint32(fPos, true); break;
            case 'e': row[colName] = dv.getInt32(fPos, true) / 100.0; break;
            case 'E': row[colName] = dv.getUint32(fPos, true) / 100.0; break;
            case 'L': row[colName] = dv.getInt32(fPos, true) * 1e-7; break;
            case 'f': row[colName] = dv.getFloat32(fPos, true); break;
            case 'd': row[colName] = dv.getFloat64(fPos, true); break;
            case 'a': row[colName] = Array.from({length:32},(_,j)=>dv.getInt16(fPos+j*2,true)); break;
            case 'q': {
              const value = dv.getBigInt64(fPos, true);
              row[colName] = value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
              break;
            }
            case 'Q': {
              const value = dv.getBigUint64(fPos, true);
              row[colName] = value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
              break;
            }
            case 'n': row[colName] = readCleanAscii(uint8Array, fPos, 4); break;
            case 'N': row[colName] = readCleanAscii(uint8Array, fPos, 16); break;
            case 'Z': row[colName] = readCleanAscii(uint8Array, fPos, 64); break;
            default: row[colName] = 0;
          }
          fPos += fSize;
        }

        if (validRow) {
          tables[schema.name].push(row);
        }
        offset += schema.length;
      }

      return {
        fileName,
        byteLength: len,
        totalPackets,
        fmtList: [fmtMap[128],...schemaDefinitions.values()].filter((f,i,all)=>all.findIndex(s=>s.name===f.name&&s.format===f.format&&s.columns.join(',')===f.columns.join(','))===i),
        tables,
        rawCounts
      };
    }

    function parseDataFlashTextLog(text, fileName = 'uploaded.log') {
      const lines = text.split(/\r?\n/);
      const fmtList = [];
      const fmtByName = {};
      const tables = {};
      const rawCounts = {};
      let totalPackets = 0;

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parts = trimmed.split(',').map(s => s.trim());
        const msgName = parts[0];
        if (!msgName) continue;

        if (msgName === 'FMT' && parts.length >= 6) {
          const typeId = parseInt(parts[1], 10) || 0;
          const length = parseInt(parts[2], 10) || 0;
          const name = parts[3];
          const format = parts[4];
          const columns = parts.slice(5);
          const schema = { typeId, length, name, format, columns, count: 0 };
          fmtList.push(schema);
          fmtByName[name] = schema;
          if (!tables[name]) tables[name] = [];
          totalPackets++;
          continue;
        }

        const schema = fmtByName[msgName];
        if (!schema) continue;
        schema.count++;
        rawCounts[msgName] = (rawCounts[msgName] || 0) + 1;
        totalPackets++;

        const row = {};
        for (let i = 0; i < schema.columns.length && i + 1 < parts.length; i++) {
          const col = schema.columns[i];
          const fChar = schema.format[i] || 'f';
          const rawVal = parts[i + 1];
          if (fChar === 'n' || fChar === 'N' || fChar === 'Z') {
            row[col] = rawVal;
          } else {
            const num = Number(rawVal);
            row[col] = (fChar === 'q' || fChar === 'Q') && !Number.isSafeInteger(num) ? rawVal : Number.isFinite(num) ? num : rawVal;
          }
        }
        tables[msgName].push(row);
      }

      return {
        fileName,
        byteLength: text.length,
        totalPackets,
        fmtList,
        tables,
        rawCounts
      };
    }

    function findNearestByTimeUS(rows, targetUs) {
      if (!rows || rows.length === 0) return {};
      let lo = 0;
      let hi = rows.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if ((rows[mid].TimeUS || 0) < targetUs) lo = mid + 1;
        else hi = mid;
      }
      if (lo > 0) {
        const prev = rows[lo - 1];
        const curr = rows[lo];
        if (Math.abs((prev.TimeUS || 0) - targetUs) < Math.abs((curr.TimeUS || 0) - targetUs)) {
          return prev;
        }
      }
      return rows[lo] || {};
    }

    // ArduCopter FRAME_CLASS values and the frame names printed in the boot "Frame: HEXA/X" message
