/* ── webpack.obf.js ──────────────────────────────────────────────────────
   Webpack Configuration with JavaScript Obfuscation
   Masar - EyesPro v1.0.0
──────────────────────────────────────────────────────────────────────────── */

const path = require('path');
const WebpackObfuscator = require('webpack-obfuscator');
const TerserPlugin = require('terser-webpack-plugin');

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Obfuscation Configuration
 * High protection level for production builds
 */
const obfuscationConfig = {
  // Control Flow Flattening - makes code harder to follow
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  
  // Dead Code Injection - adds useless code
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.4,
  
  // Debug Protection - prevents debugging
  debugProtection: true,
  debugProtectionInterval: 2000,
  
  // Disable Console Output in production
  disableConsoleOutput: true,
  
  // Domain Lock - only runs on specific domains (for web)
  // domainLock: ['localhost', 'eyespro.masar.network'],
  
  // Identifier Names Generator
  identifierNamesGenerator: 'mangled', // or 'hexadecimal'
  
  // Log removal
  log: false,
  
  // Numbers extraction
  numbersToExpressions: true,
  
  // Rename Globals
  renameGlobals: true,
  
  // Rotate String Array
  rotateStringArray: true,
  rotateStringArrayEnabled: true,
  
  // Self Defending - prevents beautification
  selfDefending: true,
  
  // Shuffle String Array
  shuffleStringArray: true,
  
  // Split Strings
  splitStrings: true,
  splitStringsChunkLength: 10,
  
  // String Array
  stringArray: true,
  stringArrayEncoding: ['rc4', 'base64'],
  stringArrayThreshold: 0.75,
  stringArrayWrappersCount: 1,
  stringArrayWrappersChainedCall: true,
  stringArrayWrappersParametersMaxCount: 2,
  stringArrayWrappersType: 'variable',
  
  // Transform Object Keys
  transformObjectKeys: true,
  
  // Unicode Escape Sequence
  unicodeEscapeSequence: true,
  
  // Target
  target: 'electron',
  
  // Source Map (disable in production)
  sourceMap: false,
  sourceMapMode: 'separate',
};

module.exports = {
  mode: 'production',
  target: 'electron-main',
  entry: './src/main/index.ts',
  
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@main': path.resolve(__dirname, 'src/main'),
      '@renderer': path.resolve(__dirname, 'src/renderer'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  
  output: {
    filename: 'index.js',
    path: path.resolve(__dirname, 'dist/main'),
    clean: true,
  },
  
  optimization: {
    minimize: true,
    minimizer: [
      new TerserPlugin({
        terserOptions: {
          compress: {
            drop_console: true,
            drop_debugger: true,
            pure_funcs: ['console.log', 'console.info', 'console.debug'],
          },
          mangle: {
            properties: {
              regex: /^_/, // Mangle private properties
            },
          },
        },
      }),
    ],
  },
  
  plugins: [
    // Apply obfuscation only in production
    ...(isProduction ? [
      new WebpackObfuscator(obfuscationConfig, [
        // Exclude files that shouldn't be obfuscated
        'node_modules/**/*.js',
        'src/main/db/migrations.ts', // Keep migrations readable
        'src/main/logger.ts', // Keep logger readable for debugging
      ]),
    ] : []),
  ],
  
  // Electron specific
  node: {
    __dirname: false,
    __filename: false,
  },
  
  externals: {
    // Native modules that shouldn't be bundled
    'better-sqlite3': 'commonjs better-sqlite3',
    'sharp': 'commonjs sharp',
    'node-machine-id': 'commonjs node-machine-id',
  },
};
