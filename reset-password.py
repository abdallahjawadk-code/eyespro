import sqlite3, hashlib, os, secrets

DB = os.path.expandvars(r'%APPDATA%\EyesPro\EyesPro\eyespro.db.working')
NEW_PASS = 'Admin@12345'

salt = secrets.token_hex(16)
h = hashlib.scrypt(NEW_PASS.encode(), salt=salt.encode(), n=16384, r=8, p=1, dklen=64).hex()

con = sqlite3.connect(DB)
cur = con.cursor()
cur.execute("UPDATE users SET password_hash=?, salt=?, is_active=1 WHERE username='admin'", (h, salt))
if cur.rowcount == 0:
    cur.execute("INSERT INTO users (username,password_hash,salt,role,email,is_active) VALUES ('admin',?,?,'super_admin','admin@eyespro.app',1)", (h, salt))
    print('Admin user created.')
else:
    print('Password reset OK.')
con.commit()
con.close()

print(f'\n  Username: admin\n  Password: {NEW_PASS}\n')
