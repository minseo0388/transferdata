const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

function initDb() {
    db.serialize(() => {
        db.run(`
            CREATE TABLE IF NOT EXISTS files (
                id TEXT PRIMARY KEY,
                code TEXT UNIQUE,
                originalName TEXT,
                filename TEXT,
                size INTEGER,
                uploadTime INTEGER,
                expiresAt INTEGER,
                uploaderId TEXT,
                downloadLimit INTEGER,
                downloadCount INTEGER DEFAULT 0
            )
        `);
    });
}

function generateCode() {
    return Math.floor(10000 + Math.random() * 90000).toString(); // 10000 ~ 99999
}

function getUniqueCode() {
    return new Promise((resolve, reject) => {
        const attempt = () => {
            const code = generateCode();
            db.get(`SELECT id FROM files WHERE code = ?`, [code], (err, row) => {
                if (err) reject(err);
                if (row) attempt(); // code exists, try again
                else resolve(code);
            });
        };
        attempt();
    });
}

function saveFile(data) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO files (id, code, originalName, filename, size, uploadTime, expiresAt, uploaderId, downloadLimit, downloadCount) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [data.id, data.code, data.originalName, data.filename, data.size, data.uploadTime, data.expiresAt, data.uploaderId, data.downloadLimit, 0],
            function (err) {
                if (err) reject(err);
                else resolve(data);
            }
        );
    });
}

function getFileByCode(code) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT * FROM files WHERE code = ?`, [code], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function incrementDownloadCount(id) {
    return new Promise((resolve, reject) => {
        db.run(`UPDATE files SET downloadCount = downloadCount + 1 WHERE id = ?`, [id], function (err) {
            if (err) reject(err);
            else resolve(this.changes);
        });
    });
}

function deleteFileRecord(id) {
    return new Promise((resolve, reject) => {
        db.run(`DELETE FROM files WHERE id = ?`, [id], function (err) {
            if (err) reject(err);
            else resolve(this.changes);
        });
    });
}

function cleanupFiles() {
    const now = Date.now();
    db.all(`SELECT * FROM files WHERE expiresAt <= ? OR (downloadLimit > 0 AND downloadCount >= downloadLimit)`, [now], (err, rows) => {
        if (err) {
            console.error('Failed to query files for cleanup:', err);
            return;
        }
        rows.forEach(row => {
            const filePath = path.join(__dirname, process.env.UPLOAD_DIR || 'uploads', row.filename);
            fs.unlink(filePath, (unlinkErr) => {
                if (unlinkErr && unlinkErr.code !== 'ENOENT') {
                    console.error('Failed to physical delete file:', unlinkErr);
                } else {
                    deleteFileRecord(row.id).catch(console.error);
                }
            });
        });
    });
}

module.exports = {
    initDb,
    getUniqueCode,
    saveFile,
    getFileByCode,
    incrementDownloadCount,
    deleteFileRecord,
    cleanupFiles
};
