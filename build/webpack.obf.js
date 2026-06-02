/* ── webpack.obf.js ──────────────────────────────────────────────────────
   Webpack Obfuscation Configuration for EyesPro
   Production-grade JavaScript protection
──────────────────────────────────────────────────────────────────────────── */

import path from 'path';
import { fileURLToPath } from 'url';
import WebpackObfuscator from 'webpack-obfuscator';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isProduction = process.env.NODE_ENV === 'production';

/**
 * High-security obfuscation configuration
 */
const obfuscationConfig = {
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.4,
  debugProtection: true,
  debugProtectionInterval: 2000,
  disableConsoleOutput: true,
  identifierNamesGenerator: 'mangled',
  log: false,
  numbersToExpressions: true,
  renameGlobals: true,
  rotateStringArray: true,
  selfDefending: true,
  shuffleStringArray: true,
  splitStrings: true,
  splitStringsChunkLength: 10,
  stringArray: true,
  stringArrayEncoding: ['rc4', 'base64'],
  stringArrayThreshold: 0.75,
  transformObjectKeys: true,
  unicodeEscapeSequence: true,
  target: 'electron'
};

export default {
  mode: 'production',
  target: 'electron-main',
  entry: './src/main/index.ts',
  module: {
    rules: [{
      test: /\.tsx?$/,
      use: 'ts-loader',
      exclude: /node_modules/
    }]
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js']
  },
  output: {
    filename: 'index.js',
    path: path.resolve(__dirname, '../dist/main')
  },
  plugins: isProduction ? [
    new WebpackObfuscator(obfuscationConfig, [
      'node_modules/**/*',
      'src/main/db/migrations.ts'
    ])
  ] : []
};
