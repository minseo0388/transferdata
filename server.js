require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const uuid = require('uuid');
const cron = require('node-cron');
const archiver = require('archiver');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3333;

// Admin credentials
const ADMIN_DISCORD_ID = process.env.ADMIN_DISCORD_ID || '1216386341554622474';
const ADMIN_GOOGLE_EMAIL = process.env.ADMIN_GOOGLE_EMAIL || 'choiminseo0388@gmail.com';

// Setup directories
const UPLOAD_DIR = path.join(__dirname, process.env.UPLOAD_DIR || 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Setup DB
db.initDb();

// Periodic cleanup (runs every hour)
cron.schedule('0 * * * *', () => {
    console.log('Running scheduled file cleanup...');
    db.cleanupFiles();
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 1 day
}));

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 200 * 1024 * 1024 } // 200MB limit per file
});

function requireAuth(req, res, next) {
    if (!req.session.user) {
        req.session.returnTo = req.originalUrl;
        return res.redirect('/auth/choice');
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!req.session.user || !req.session.user.isAdmin) {
        return res.status(403).render('error', { message: '관리자만 접근할 수 있습니다.' });
    }
    next();
}

// Routes

app.get('/', (req, res) => {
    res.render('index', { user: req.session.user, error: req.query.error });
});

app.get('/terms', (req, res) => {
    res.render('terms');
});

app.get('/upload', requireAuth, (req, res) => {
    res.render('upload', { user: req.session.user });
});

// Auth choice page
app.get('/auth/choice', (req, res) => {
    res.render('auth-choice');
});

// Discord OAuth
app.get('/auth/discord', (req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const redirectUri = encodeURIComponent(process.env.DISCORD_CALLBACK_URL);
    res.redirect(`https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=identify`);
});

app.get('/auth/discord/callback', async (req, res) => {
    if (!req.query.code) return res.redirect('/?error=NoCode');

    try {
        const params = new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID,
            client_secret: process.env.DISCORD_CLIENT_SECRET,
            grant_type: 'authorization_code',
            code: req.query.code,
            redirect_uri: process.env.DISCORD_CALLBACK_URL
        });

        const tokenResponse = await axios.post('https://discord.com/api/oauth2/token', params.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        const accessToken = tokenResponse.data.access_token;

        const userResponse = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const discordUser = userResponse.data;
        const discordId = discordUser.id;
        const email = discordUser.email;

        // Check if user exists
        const existingUser = await db.checkUserExists('discord', null, discordId);

        if (!existingUser) {
            // Automatically create user
            await db.createUser({
                id: uuid.v4(),
                provider: 'discord',
                providerEmail: email,
                providerDiscordId: discordId,
                username: discordUser.username
            });
        }

        // Check if admin
        const isAdmin = discordId === ADMIN_DISCORD_ID;

        // Set session
        req.session.user = {
            id: discordId,
            provider: 'discord',
            username: discordUser.username,
            avatar: discordUser.avatar,
            isAdmin: isAdmin
        };

        const returnTo = req.session.returnTo || '/';
        delete req.session.returnTo;
        res.redirect(returnTo);

    } catch (err) {
        console.error(err);
        res.redirect('/?error=AuthFailed');
    }
});

// Google OAuth
app.get('/auth/google', (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = encodeURIComponent(process.env.GOOGLE_CALLBACK_URL);
    const scope = encodeURIComponent('openid profile email');
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}`);
});

app.get('/auth/google/callback', async (req, res) => {
    if (!req.query.code) return res.redirect('/?error=NoCode');

    try {
        // Exchange code for token
        const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            code: req.query.code,
            grant_type: 'authorization_code',
            redirect_uri: process.env.GOOGLE_CALLBACK_URL
        });

        const accessToken = tokenResponse.data.access_token;

        // Get user info
        const userResponse = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });

        const googleUser = userResponse.data;
        const email = googleUser.email;

        // Check if user exists
        const existingUser = await db.checkUserExists('google', email, null);

        if (!existingUser) {
            // Automatically create user
            await db.createUser({
                id: uuid.v4(),
                provider: 'google',
                providerEmail: email,
                providerDiscordId: null,
                username: googleUser.name
            });
        }

        // Check if admin
        const isAdmin = email === ADMIN_GOOGLE_EMAIL;

        // Set session
        req.session.user = {
            id: email,
            provider: 'google',
            username: googleUser.name,
            email: email,
            isAdmin: isAdmin
        };

        const returnTo = req.session.returnTo || '/';
        delete req.session.returnTo;
        res.redirect(returnTo);

    } catch (err) {
        console.error(err);
        res.redirect('/?error=AuthFailed');
    }
});

// Registration page and handler
app.get('/auth/register', (req, res) => {
    const provider = req.query.provider;
    if (!provider || (provider !== 'discord' && provider !== 'google')) {
        return res.render('error', { message: '잘못된 요청입니다.' });
    }

    let tempUser = null;
    if (provider === 'discord') {
        tempUser = req.session.tempDiscordUser;
    } else if (provider === 'google') {
        tempUser = req.session.tempGoogleUser;
    }

    if (!tempUser) {
        return res.render('error', { message: '다시 로그인해주세요.' });
    }

    res.render('register', { provider, tempUser });
});

app.post('/auth/register', async (req, res) => {
    try {
        const provider = req.body.provider;
        const username = req.body.username;
        const confirmIdentifier = req.body.confirmIdentifier;

        if (!provider || !username || !confirmIdentifier) {
            return res.status(400).json({ success: false, message: '필수 정보가 누락되었습니다.' });
        }

        let tempUser = null;
        if (provider === 'discord') {
            tempUser = req.session.tempDiscordUser;
        } else if (provider === 'google') {
            tempUser = req.session.tempGoogleUser;
        }

        if (!tempUser) {
            return res.status(400).json({ success: false, message: '다시 로그인해주세요.' });
        }

        // Verify identifier matches
        let isMatch = false;
        if (provider === 'discord') {
            isMatch = confirmIdentifier === tempUser.id;
        } else if (provider === 'google') {
            isMatch = confirmIdentifier === tempUser.email;
        }

        if (!isMatch) {
            return res.status(400).json({ success: false, message: '일치하지 않는 정보입니다.' });
        }

        // Create pending registration
        const pendingId = uuid.v4();
        const pendingData = {
            id: pendingId,
            provider: provider,
            username: username,
            providerEmail: provider === 'google' ? tempUser.email : null,
            providerDiscordId: provider === 'discord' ? tempUser.id : null
        };

        await db.createPendingRegistration(pendingData);

        // Clear temp data
        delete req.session.tempDiscordUser;
        delete req.session.tempGoogleUser;

        return res.json({ 
            success: true, 
            message: '가입 신청이 제출되었습니다. 관리자의 승인을 기다려주세요.',
            redirect: '/'
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
    }
});

// Admin panel
app.get('/admin', requireAdmin, async (req, res) => {
    try {
        const pending = await db.getPendingRegistrations();
        res.render('admin', { user: req.session.user, pending });
    } catch (err) {
        console.error(err);
        res.render('error', { message: '오류가 발생했습니다.' });
    }
});

// Approve registration
app.post('/admin/approve', requireAdmin, async (req, res) => {
    try {
        const registrationId = req.body.registrationId;
        if (!registrationId) {
            return res.status(400).json({ success: false, message: '잘못된 요청입니다.' });
        }

        await db.approvePendingRegistration(registrationId);
        res.json({ success: true, message: '승인 완료' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '오류가 발생했습니다.' });
    }
});

// Reject registration
app.post('/admin/reject', requireAdmin, async (req, res) => {
    try {
        const registrationId = req.body.registrationId;
        if (!registrationId) {
            return res.status(400).json({ success: false, message: '잘못된 요청입니다.' });
        }

        await db.rejectPendingRegistration(registrationId);
        res.json({ success: true, message: '거부 완료' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '오류가 발생했습니다.' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});


app.post('/api/upload', requireAuth, upload.array('files', 5), async (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, message: '파일이 없습니다.' });
    }

    try {
        const downloadLimit = parseInt(req.body.downloadLimit) || 1; // Default: 1 (1회성)
        const daysToKeep = parseInt(req.body.daysToKeep) || 30; // Default: 30 days
        const expiresAt = Date.now() + (daysToKeep * 24 * 60 * 60 * 1000);
        
        const code = await db.getUniqueCode();
        
        let finalFilename = '';
        let finalOriginalName = '';
        let finalSize = 0;

        if (req.files.length === 1) {
            finalFilename = req.files[0].filename;
            finalOriginalName = req.files[0].originalname;
            finalSize = req.files[0].size;
        } else {
            // Zip multiple files
            finalOriginalName = `Secure_Transfer_${code}.zip`;
            finalFilename = `${Date.now()}-${Math.round(Math.random() * 1E9)}.zip`;
            const zipPath = path.join(UPLOAD_DIR, finalFilename);
            
            const output = fs.createWriteStream(zipPath);
            const archive = archiver('zip', { zlib: { level: 9 } });
            
            await new Promise((resolve, reject) => {
                output.on('close', () => resolve());
                archive.on('error', err => reject(err));
                archive.pipe(output);
                
                req.files.forEach(file => {
                    archive.file(file.path, { name: file.originalname });
                });
                
                archive.finalize();
            });
            
            finalSize = fs.statSync(zipPath).size;
            
            // Delete original uploaded files
            req.files.forEach(file => {
                fs.unlink(file.path, (err) => {
                    if (err) console.error('Failed to delete temp file:', err);
                });
            });
        }
        
        const fileData = {
            id: uuid.v4(),
            code: code,
            originalName: finalOriginalName,
            filename: finalFilename,
            size: finalSize,
            uploadTime: Date.now(),
            expiresAt: expiresAt,
            uploaderId: req.session.user.id,
            downloadLimit: downloadLimit
        };

        await db.saveFile(fileData);
        res.json({ success: true, code: code });

    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
    }
});

app.get('/api/check/:code', async (req, res) => {
    try {
        const fileData = await db.getFileByCode(req.params.code);
        if (!fileData) return res.json({ success: false, message: '파일을 찾을 수 없거나 이미 삭제되었습니다.' });
        if (fileData.expiresAt <= Date.now()) return res.json({ success: false, message: '만료된 파일입니다.' });
        if (fileData.downloadLimit > 0 && fileData.downloadCount >= fileData.downloadLimit) return res.json({ success: false, message: '다운로드 횟수를 초과하였습니다.' });
        
        const filePath = path.join(UPLOAD_DIR, fileData.filename);
        if (!fs.existsSync(filePath)) return res.json({ success: false, message: '서버에서 실제 파일을 찾을 수 없습니다.' });

        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
    }
});

app.get('/api/download/:code', async (req, res) => {
    const code = req.params.code;
    
    try {
        const fileData = await db.getFileByCode(code);
        if (!fileData) {
            return res.redirect('/?error=' + encodeURIComponent('파일을 찾을 수 없거나 이미 삭제되었습니다.'));
        }

        if (fileData.expiresAt <= Date.now()) {
            return res.redirect('/?error=' + encodeURIComponent('만료된 파일입니다.'));
        }

        if (fileData.downloadLimit > 0 && fileData.downloadCount >= fileData.downloadLimit) {
            return res.redirect('/?error=' + encodeURIComponent('다운로드 횟수를 초과하였습니다.'));
        }

        const filePath = path.join(UPLOAD_DIR, fileData.filename);
        if (!fs.existsSync(filePath)) {
            return res.redirect('/?error=' + encodeURIComponent('서버에서 실제 파일을 찾을 수 없습니다.'));
        }

        await db.incrementDownloadCount(fileData.id);
        
        res.download(filePath, fileData.originalName, (err) => {
            if (err) {
                console.error("Download error:", err);
            }
            // Trigger cleanup lazily
            db.cleanupFiles();
        });

    } catch (err) {
        console.error(err);
        res.redirect('/?error=' + encodeURIComponent('서버 오류가 발생했습니다.'));
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
