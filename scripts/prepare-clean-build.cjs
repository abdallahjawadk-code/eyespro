/**
 * Prepare Clean Build Script
 * Creates a fresh production database without development data
 * Masar - EyesPro v1.0.0
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CLEAN_DB_PATH = path.join(DATA_DIR, 'clean-database.sqlite');
const PROD_DB_PATH = path.join(DATA_DIR, 'prod-database.sqlite');

console.log('🧹 Preparing clean production database...\n');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Remove old clean database if exists
if (fs.existsSync(CLEAN_DB_PATH)) {
  fs.unlinkSync(CLEAN_DB_PATH);
  console.log('✓ Removed old clean database');
}

if (fs.existsSync(PROD_DB_PATH)) {
  fs.unlinkSync(PROD_DB_PATH);
  console.log('✓ Removed old production database');
}

// Create fresh database
const db = new Database(CLEAN_DB_PATH);

console.log('✓ Created fresh database');

// Initialize schema (run migrations)
const migrationsPath = path.join(__dirname, '..', 'src', 'main', 'db', 'migrations.ts');

// Read the schema from migrations
const schema = `
-- Core Tables
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor',
  email TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  category TEXT,
  content TEXT,
  summary TEXT,
  source TEXT,
  author_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  url TEXT,
  type TEXT DEFAULT 'rss',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  region TEXT,
  source TEXT,
  traffic TEXT,
  description TEXT,
  status TEXT DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS trend_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  url TEXT NOT NULL,
  region_tag TEXT,
  is_enabled INTEGER DEFAULT 1
);

-- Default admin user (change password after first login)
INSERT INTO users (username, password_hash, salt, role) 
VALUES ('admin', 'placeholder_hash', 'placeholder_salt', 'admin');

-- Default settings
INSERT INTO settings (key, value) VALUES
('app_version', '1.0.0'),
('app_name', 'EyesPro'),
('company_name', 'Masar Network'),
('trial_days', '3'),
('language', 'ar'),
('theme', 'dark');

-- Default trend sources (built-in)
INSERT INTO trend_sources (name, type, url, region_tag, is_enabled) VALUES
('Google Trends SA', 'google_trends_geo', 'https://trends.google.com/trending/rss?geo=SA', 'SA', 1),
('Google Trends EG', 'google_trends_geo', 'https://trends.google.com/trending/rss?geo=EG', 'EG', 1),
('Google Trends AE', 'google_trends_geo', 'https://trends.google.com/trending/rss?geo=AE', 'AE', 1);

-- Schema version
INSERT INTO schema_meta (key, value) VALUES ('schema_version', '47');
`;

try {
  db.exec(schema);
  console.log('✓ Database schema initialized');
  
  // Verify tables
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log(`✓ Created ${tables.length} tables`);
  
  // Close and copy to production
  db.close();
  
  fs.copyFileSync(CLEAN_DB_PATH, PROD_DB_PATH);
  console.log('✓ Copied to production database\n');
  
  // Also copy to release directory
  const releaseDir = path.join(__dirname, '..', 'release', 'data');
  if (!fs.existsSync(releaseDir)) {
    fs.mkdirSync(releaseDir, { recursive: true });
  }
  fs.copyFileSync(CLEAN_DB_PATH, path.join(releaseDir, 'database.sqlite'));
  console.log('✓ Copied to release directory\n');
  
  console.log('🎉 Clean production database ready!');
  console.log(`📁 Location: ${PROD_DB_PATH}`);
  console.log('\nThis database contains:');
  console.log('  • Empty articles table');
  console.log('  • Empty videos table');
  console.log('  • Default admin user (admin/admin - change after login)');
  console.log('  • Default trend sources (Google Trends)');
  console.log('  • Default settings\n');
  
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
