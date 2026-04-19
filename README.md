# transfer

[![standard-readme compliant](https://img.shields.io/badge/readme%20style-standard-brightgreen.svg?style=flat-square)](https://github.com/RichardLitt/standard-readme)

> A simple, secure data transfer application using 5-digit codes.

This project provides a lightweight web service for uploading and downloading files. It uses Discord OAuth for access control, issues a unique 5-digit code for each uploaded file, and automatically handles file expiration and deletion.

## Table of Contents

- [Install](#install)
- [Usage](#usage)
- [Configuration](#configuration)
- [Maintainers](#maintainers)
- [Contributing](#contributing)
- [License](#license)

## Install

Requires Node.js (v18 or newer).

```sh
git clone https://github.com/minseo0388/transfer.git
cd transfer
npm install
```

## Usage

Start the server using `npm`:

```sh
npm start
```

The application will be accessible at `http://localhost:3000`. 
- **Download**: Enter the 5-digit code on the main page.
- **Upload**: Click the upload button to authenticate via Discord, configure file limits, and receive your code.

## Configuration

Copy the example environment file:

```sh
cp .env.example .env
```

Edit the `.env` file to configure your Discord OAuth and permissions:

```env
PORT=3000
DISCORD_CLIENT_ID=your_client_id
DISCORD_CLIENT_SECRET=your_client_secret
DISCORD_CALLBACK_URL=http://your-domain.com/auth/discord/callback
SESSION_SECRET=secure_session_secret

# Specify allowed Discord guilds (servers) and required roles.
# Format: GuildID:RoleID,GuildID:RoleID
# Example: 112233:998877,445566: 
# (Leave the RoleID empty if joining the guild is sufficient)
ALLOWED_GUILDS=your_guild_id_here:your_role_id_here

UPLOAD_DIR=uploads
```

## Maintainers

[@minseo0388](https://github.com/minseo0388)

## Contributing

PRs accepted.

Small note: If editing the README, please conform to the [standard-readme](https://github.com/RichardLitt/standard-readme) specification.

## License

MIT © 2026
