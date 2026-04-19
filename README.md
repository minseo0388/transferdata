# Secure Data Transfer

A premium, minimalistic, and secure web application for transferring files. Upload files to receive a unique 5-digit code, and effortlessly download them anywhere without needing a USB drive.

## ✨ Features

- **5-Digit Code System**: Easily download files by entering a unique, auto-generated 5-digit code.
- **Discord OAuth Auth**: File upload access is strictly controlled using Discord OAuth.
  - Supports role-based access control.
  - Flexible multi-server configurations (allow members from Guild A with a specific role, or anyone from Guild B).
- **Secure File Expiration**: Files are automatically deleted via a background cron job once they expire or hit the maximum download limit.
- **Modern Minimal UI**: Built with a dark mode sleek Vercel/Linear-like design with beautiful micro-interactions, responsive drag & drop, and slide-in notifications.
- **AJAX Driven Verifications**: Checking code validity without annoying page reloads or redirects.

## 🚀 Getting Started

### 1. Prerequisites
- Node.js (v18+)
- NPM
- A Discord Developer App for OAuth configuration.

### 2. Installation
Clone the repository and install dependencies:
\`\`\`bash
git clone https://github.com/USERNAME/REPO_NAME.git
cd REPO_NAME
npm install
\`\`\`

### 3. Environment Variables
Copy the template to create your `.env` file:
\`\`\`bash
cp .env.example .env
\`\`\`

Edit `.env` and fill out your Discord Portal credentials:
\`\`\`env
PORT=3000
DISCORD_CLIENT_ID=your_client_id_here
DISCORD_CLIENT_SECRET=your_client_secret_here
DISCORD_CALLBACK_URL=http://localhost:3000/auth/discord/callback
SESSION_SECRET=a_very_secure_secret_key

# Define rules for allowed guilds via: Guild_ID:Role_ID
# Example 1: 112233:998877 (Role explicitly required)
# Example 2: 112233:, 445566: (No role required, membership to either server is enough)
ALLOWED_GUILDS=your_guild_id_here:your_role_id_here

UPLOAD_DIR=uploads
\`\`\`

### 4. Running the Server
\`\`\`bash
npm start
\`\`\`
The application will be running at \`http://localhost:3000\`.

## 🛠 Tech Stack
- **Backend:** Node.js, Express
- **View Engine:** EJS
- **Database:** SQLite (No external database setups required)
- **Styling:** Vanilla CSS (Pretendard Font, Modern UI styling)
- **File Handling:** Multer
- **Background Jobs:** Node-Cron

## 💡 Notes
- Upload limit is set to **200MB**.
- Ensure \`uploads\` directory exists or has write permissions (app creates it automatically).
- Periodic cleanup runs every hour to physically delete expired files safely.
