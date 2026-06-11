# Secure Data Transfer

[![standard-readme compliant](https://img.shields.io/badge/readme%20style-standard-brightgreen.svg?style=flat-square)](https://github.com/RichardLitt/standard-readme)

> A secure, private web service for transferring large files using 5-digit codes and social login.

This project provides a lightweight, fully private web service for uploading and downloading files. It features an admin approval system, multi-file zipping, automatic file expiration via scheduling, and seamless authentication via Google and Discord.

## Table of Contents

- [Background](#background)
- [Install](#install)
- [Usage](#usage)
- [Configuration](#configuration)
- [Maintainers](#maintainers)
- [Contributing](#contributing)
- [License](#license)

## Background

Originally built to share files securely within restricted communities, this tool has evolved into a robust transfer platform. It uses SQLite for lightweight data management and handles up to 1GB (max 5 files) per upload, generating a simple 5-digit code for easy retrieval.

## Install

Requires Node.js (v18 or newer).

```sh
git clone https://github.com/minseo0388/transferdata.git
cd transferdata
npm install
```

## Usage

Start the server using `npm`:

```sh
npm start
```

The application will be accessible at `http://localhost:3333` (or the port specified in `.env`). 
- **Download**: Enter the 5-digit code on the main page. Multiple files will be automatically zipped.
- **Upload**: Authenticate via Google or Discord. New users must be approved by an Admin.
- **Admin Dashboard**: Admins can visit `/admin` to approve or reject pending user registrations.

## Configuration

Copy the example environment file:

```sh
cp .env.example .env
```

Edit the `.env` file to configure your server, OAuth providers, and Admin accounts:

```env
PORT=3333
SESSION_SECRET=a_very_secure_session_secret_key
UPLOAD_DIR=uploads

# Discord OAuth Configuration
DISCORD_CLIENT_ID=your_discord_client_id
DISCORD_CLIENT_SECRET=your_discord_client_secret
DISCORD_CALLBACK_URL=http://your-domain.com/auth/discord/callback

# Google OAuth Configuration
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://your-domain.com/auth/google/callback

# Admin Setup (Required to access the /admin dashboard and approve users)
ADMIN_DISCORD_ID=your_discord_user_id
ADMIN_GOOGLE_EMAIL=your_google_email@gmail.com
```

## Maintainers

[@minseo0388](https://github.com/minseo0388)

## Contributing

PRs accepted.

Small note: If editing the README, please conform to the [standard-readme](https://github.com/RichardLitt/standard-readme) specification.

## License

MIT © 2026
