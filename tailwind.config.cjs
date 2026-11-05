module.exports = {
  content: ['./src/index.template.html', './src/js/**/*.js'],
  darkMode: 'class',
  theme: { extend: {
    fontFamily: { sans: ['Inter','-apple-system','BlinkMacSystemFont','sans-serif'], mono: ['JetBrains Mono','monospace'] },
    colors: { slate: { 850:'#131c2e', 925:'#0b1120', 950:'#060a13' } }
  } }
};
