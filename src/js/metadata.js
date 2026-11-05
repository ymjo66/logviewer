    const COPTER_MODES = {
      0: { name: 'STABILIZE', color: '#38bdf8', desc: '수동 자세 안정화 모드' },
      1: { name: 'ACRO', color: '#a855f7', desc: '아크로바틱 각속도 제어' },
      2: { name: 'ALT_HOLD', color: '#60a5fa', desc: '기압계/고도 유지 모드' },
      3: { name: 'AUTO', color: '#10b981', desc: '자동 웨이포인트 임무 비행' },
      4: { name: 'GUIDED', color: '#34d399', desc: 'GCS 외부 유도 제어 모드' },
      5: { name: 'LOITER', color: '#22d3ee', desc: 'GPS 위치·고도 고정 호버링' },
      6: { name: 'RTL', color: '#f59e0b', desc: '이륙 지점 자동 복귀 (Return to Launch)' },
      7: { name: 'CIRCLE', color: '#818cf8', desc: '원형 선회 비행 모드' },
      9: { name: 'LAND', color: '#f43f5e', desc: '자동 강하 및 착륙 모드' },
      11: { name: 'DRIFT', color: '#c084fc', desc: '드리프트 비행 모드' },
      16: { name: 'POSHOLD', color: '#14b8a6', desc: '위치 고정 및 스틱 직접 제어' },
      17: { name: 'BRAKE', color: '#fb923c', desc: '급제동 정지 모드' },
      21: { name: 'SMART_RTL', color: '#eab308', desc: '진입 경로 역추적 자동 복귀' }
    };

    const EV_DESCRIPTIONS = {
      10: { name: 'ARMED', ko: '모터 시동 완료 (Armed)', badge: 'amber' },
      11: { name: 'DISARMED', ko: '모터 시동 해제 (Disarmed)', badge: 'slate' },
      15: { name: 'AUTO_ARMED', ko: '자동 임무 이륙 준비 완료 (Auto Armed)', badge: 'sky' },
      17: { name: 'LAND_COMPLETE_MAYBE', ko: '착륙 접지 감지 예비 (Land Complete Maybe)', badge: 'indigo' },
      18: { name: 'LAND_COMPLETE', ko: '착륙 완료 판정 (Land Complete)', badge: 'indigo' },
      28: { name: 'NOT_LANDED', ko: '이륙 완료 / 지상 이탈 (Takeoff / Not Landed)', badge: 'sky' },
      43: { name: 'ACRO_TRAINER_OFF', ko: 'ACRO 트레이너 해제', badge: 'slate' },
      44: { name: 'ACRO_TRAINER_LEVELING', ko: 'ACRO 트레이너 수평 보조', badge: 'slate' },
      60: { name: 'EKF_ALT_RESET', ko: 'EKF 고도 기준점 리셋', badge: 'rose' },
      62: { name: 'EKF_YAW_RESET', ko: 'EKF 기수(Yaw) 방위 리셋', badge: 'amber' }
    };

    const ERR_SUBSYS = {
      2: '무선조종(Radio)',
      3: '콤파스(Compass)',
      5: 'RC 조종기 페일세이프(Radio FS)',
      6: '배터리 페일세이프(Battery FS)',
      8: 'GCS 통신 페일세이프(GCS FS)',
      9: '지오펜스 이탈(Fence FS)',
      10: '비행모드 전환 실패(Mode Change)',
      11: 'GPS 글리치(GPS Glitch)',
      12: '추락 감지(Crash Check)',
      16: 'EKF 분산 불량(EKF Variance)',
      17: 'EKF 페일세이프(EKF FS)',
      18: '기압계 불량(Barometer)',
      24: 'EKF 주 코어 전환(EKF Primary)',
      25: '추력 손실 감지(Thrust Loss)',
      29: '진동 보상 작동(Vibration FS)'
    };

    const PARM_DOCS = {
      'FRAME_CLASS': '기체 프레임 클래스 (1=Quad, 2=Hexa, 3=Octa, 7=Tri)',
      'FRAME_TYPE': '모터 배열 형태 (1=X형, 0=+형, 2=V형)',
      'INS_ACCEL_FILTER': '가속도계 로우패스 필터 차단주파수 (기본 20Hz)',
      'INS_GYRO_FILTER': '자이로스코프 로우패스 필터 차단주파수 (Hz)',
      'BATT_MONITOR': '배터리 모니터 센서 유형 (4=전압 및 전류 아날로그)',
      'BATT_CAPACITY': '배터리 정격 용량 (mAh)',
      'BATT_LOW_VOLT': '배터리 1차 저전압 페일세이프 기준 전압 (V)',
      'BATT_CRT_VOLT': '배터리 2차 위험 저전압 강제착륙 기준 전압 (V)',
      'FS_THR_ENABLE': '조종기 신호 두절(RC Failsafe) 작동 설정 (1=항상 RTL)',
      'FS_EKF_THRESH': 'EKF 분산 페일세이프 임계값 (기본 0.8)',
      'PILOT_TKOFF_ALT': '조종기 자동 이륙 목표 고도 (cm)',
      'RTL_ALT': '자동 복귀(RTL) 시 최소 유지 고도 (cm)',
      'WPNAV_SPEED': '자동 임무 비행 시 수평 이동 속도 (cm/s)',
      'ATC_RAT_RLL_P': '롤(Roll) 각속도 PID 제어기 P 게인',
      'ATC_RAT_PIT_P': '피치(Pitch) 각속도 PID 제어기 P 게인',
      'PSC_POSZ_P': '고도(Z축) 위치 제어기 P 게인'
    };
