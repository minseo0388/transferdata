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
        
        // 승인된 사용자 테이블 - 최소한의 정보만 저장
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                provider TEXT,
                providerEmail TEXT UNIQUE,
                providerDiscordId TEXT UNIQUE,
                username TEXT,
                approvedAt INTEGER,
                createdAt INTEGER
            )
        `);
        
        // 승인 대기 중인 가입 신청 테이블 - 개인정보 최소화
        db.run(`
            CREATE TABLE IF NOT EXISTS pending_registrations (
                id TEXT PRIMARY KEY,
                provider TEXT,
                providerEmail TEXT,
                providerDiscordId TEXT,
                username TEXT,
                requestedAt INTEGER,
                status TEXT DEFAULT 'pending'
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

// User management functions
function getUserById(userId) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT * FROM users WHERE id = ?`, [userId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function getUserByProviderId(provider, email, discordId) {
    return new Promise((resolve, reject) => {
        let query = `SELECT * FROM users WHERE provider = ?`;
        let params = [provider];
        
        if (provider === 'google' && email) {
            query += ` AND providerEmail = ?`;
            params.push(email);
        } else if (provider === 'discord' && discordId) {
            query += ` AND providerDiscordId = ?`;
            params.push(discordId);
        }
        
        db.get(query, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function createUser(userData) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO users (id, provider, providerEmail, providerDiscordId, username, approvedAt, createdAt) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [userData.id, userData.provider, userData.providerEmail || null, userData.providerDiscordId || null, userData.username, Date.now(), Date.now()],
            function (err) {
                if (err) reject(err);
                else resolve(userData);
            }
        );
    });
}

function checkUserExists(provider, email, discordId) {
    return new Promise((resolve, reject) => {
        let query = `SELECT id FROM users WHERE provider = ?`;
        let params = [provider];
        
        if (provider === 'google' && email) {
            query += ` AND providerEmail = ?`;
            params.push(email);
        } else if (provider === 'discord' && discordId) {
            query += ` AND providerDiscordId = ?`;
            params.push(discordId);
        }
        
        db.get(query, params, (err, row) => {
            if (err) reject(err);
            else resolve(!!row);
        });
    });
}

function createPendingRegistration(data) {
    return new Promise((resolve, reject) => {
        db.run(
            `INSERT INTO pending_registrations (id, provider, providerEmail, providerDiscordId, username, requestedAt, status) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [data.id, data.provider, data.providerEmail || null, data.providerDiscordId || null, data.username, Date.now(), 'pending'],
            function (err) {
                if (err) reject(err);
                else resolve(data);
            }
        );
    });
}

function getPendingRegistrations() {
    return new Promise((resolve, reject) => {
        db.all(`SELECT * FROM pending_registrations WHERE status = 'pending' ORDER BY requestedAt DESC`, [], (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

function approvePendingRegistration(registrationId) {
    return new Promise((resolve, reject) => {
        db.get(`SELECT * FROM pending_registrations WHERE id = ?`, [registrationId], (err, row) => {
            if (err) {
                reject(err);
                return;
            }
            if (!row) {
                reject(new Error('Pending registration not found'));
                return;
            }
            
            // Create user
            const userId = row.id;
            db.run(
                `INSERT INTO users (id, provider, providerEmail, providerDiscordId, username, approvedAt, createdAt) 
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [userId, row.provider, row.providerEmail, row.providerDiscordId, row.username, Date.now(), Date.now()],
                function (err) {
                    if (err) {
                        reject(err);
                        return;
                    }
                    
                    // Update pending registration status
                    db.run(`UPDATE pending_registrations SET status = 'approved' WHERE id = ?`, [registrationId], function (err) {
                        if (err) reject(err);
                        else resolve({ id: userId });
                    });
                }
            );
        });
    });
}

function rejectPendingRegistration(registrationId) {
    return new Promise((resolve, reject) => {
        db.run(`UPDATE pending_registrations SET status = 'rejected' WHERE id = ?`, [registrationId], function (err) {
            if (err) reject(err);
            else resolve(this.changes);
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
    cleanupFiles,
    // User management functions
    getUserById,
    getUserByProviderId,
    createUser,
    createPendingRegistration,
    getPendingRegistrations,
    approvePendingRegistration,
    rejectPendingRegistration,
    checkUserExists
};
