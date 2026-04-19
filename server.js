require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const uuid = require('uuid');
const cron = require('node-cron');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

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
    limits: { fileSize: 200 * 1024 * 1024 } // 200MB limit
});

function requireAuth(req, res, next) {
    if (!req.session.user) {
        req.session.returnTo = req.originalUrl;
        return res.redirect('/auth/discord');
    }
    next();
}

app.get('/', (req, res) => {
    res.render('index', { user: req.session.user, error: req.query.error });
});

app.get('/upload', requireAuth, (req, res) => {
    res.render('upload', { user: req.session.user });
});

app.get('/auth/discord', (req, res) => {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const redirectUri = encodeURIComponent(process.env.DISCORD_CALLBACK_URL);
    // require guilds.members.read to check user's roles in the server
    res.redirect(`https://discord.com/api/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=code&scope=identify%20guilds%20guilds.members.read`);
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

        const guildId = process.env.REQUIRED_GUILD_ID;
        const roleId = process.env.REQUIRED_ROLE_ID;
        
        let hasAccess = false;
        
        if (guildId && roleId) {
            try {
                const memberResponse = await axios.get(`https://discord.com/api/users/@me/guilds/${guildId}/member`, {
                    headers: { Authorization: `Bearer ${accessToken}` }
                });
                
                const roles = memberResponse.data.roles;
                if (roles.includes(roleId)) {
                    hasAccess = true;
                }
            } catch (err) {
                console.error("Failed to fetch member details", err.response?.data || err.message);
                // User not in guild or other error
            }
        } else {
             hasAccess = true; // allow all if not configured (for dev/test)
        }

        if (!hasAccess) {
             return res.render('error', { message: '권한이 없습니다. 지정된 디스코드 서버에서 알맞은 역할을 보유해야 합니다.' });
        }

        req.session.user = {
            id: userResponse.data.id,
            username: userResponse.data.username,
            avatar: userResponse.data.avatar
        };

        const returnTo = req.session.returnTo || '/';
        delete req.session.returnTo;
        res.redirect(returnTo);

    } catch (err) {
        console.error(err.response?.data || err.message);
        res.redirect('/?error=AuthFailed');
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});


app.post('/api/upload', requireAuth, upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: '파일이 없습니다.' });
    }

    try {
        const downloadLimit = parseInt(req.body.downloadLimit) || 1; // Default: 1 (1회성)
        const daysToKeep = parseInt(req.body.daysToKeep) || 30; // Default: 30 days
        const expiresAt = Date.now() + (daysToKeep * 24 * 60 * 60 * 1000);
        
        const code = await db.getUniqueCode();
        
        const fileData = {
            id: uuid.v4(),
            code: code,
            originalName: req.file.originalname,
            filename: req.file.filename,
            size: req.file.size,
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
