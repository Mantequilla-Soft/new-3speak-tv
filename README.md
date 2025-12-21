# 3Speak - Decentralized Video Platform

<p align="center">
  <img src="public/3speak.jpeg" alt="3Speak Logo" width="120" />
</p>

<p align="center">
  <strong>The decentralized video platform built on the Hive blockchain</strong>
</p>

<p align="center">
  <a href="https://3speak.tv">Live Site</a> •
  <a href="#features">Features</a> •
  <a href="#getting-started">Getting Started</a> •
  <a href="#development">Development</a> •
  <a href="#contributing">Contributing</a>
</p>

---

## About

3Speak is a decentralized, censorship-resistant video hosting platform that leverages the Hive blockchain for content storage and monetization. Creators own their content and earn cryptocurrency rewards directly from their audience.

## Features

- 🎬 **Decentralized Video Hosting** - Videos stored on IPFS and Hive
- 💰 **Creator Monetization** - Earn HIVE/HBD through upvotes and tips
- 🔐 **Censorship Resistant** - No central authority can remove your content
- 👛 **Multiple Auth Options** - Hive Keychain, HiveAuth, and more
- 🏘️ **Community Support** - Organize content by Hive communities
- 📱 **Responsive Design** - Works on desktop and mobile

## Tech Stack

- **Frontend**: React 18 + Vite
- **State Management**: Zustand + Redux Toolkit
- **Styling**: SCSS
- **Blockchain**: Hive (via @hiveio/dhive)
- **Authentication**: Hive Keychain SDK, HiveAuth, Aioha
- **GraphQL**: Apollo Client
- **Video Player**: JW Player

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- [Hive Keychain](https://hive-keychain.com/) browser extension (recommended)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/3speaknetwork/new-3speak-tv.git
   cd new-3speak-tv
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```
   Then edit `.env` with your configuration values (see [Environment Variables](#environment-variables)).

4. **Start the development server**
   ```bash
   npm run dev
   ```

   > ⚠️ **Note**: Due to a known issue with Vite's dev server and Node.js polyfills, you may need to use production preview mode for local development:
   > ```bash
   > npm run build && npm run preview
   > ```

5. **Open your browser**
   - Dev server: http://localhost:5173
   - Preview server: http://localhost:4173

## Environment Variables

Create a `.env` file in the root directory with the following variables:

| Variable | Description | Required |
|----------|-------------|----------|
| `VITE_API_URL_FROM_WEST` | Main 3Speak API endpoint | ✅ |
| `VITE_GRAPHQL_API_URL` | GraphQL API for video queries | ✅ |
| `VITE_APP_VIDEO_CDN_DOMAIN` | Video CDN domain | ✅ |
| `VITE_UPLOAD_TOKEN` | Upload authentication token | ✅ |
| `VITE_UPLOAD_URL` | Upload endpoint URL | ✅ |
| `VITE_JWPLAYER_LICENSE_ID` | JW Player license ID | ❌ |
| `VITE_JWPLAYER_LICENSE_KEY` | JW Player license key | ❌ |

See `.env.example` for a complete template.

## Available Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build locally |
| `npm run lint` | Run ESLint |

## Project Structure

```
src/
├── assets/          # Static assets (images, fonts)
├── auth/            # Authentication utilities
├── components/      # React components
│   ├── Cards/       # Video card components
│   ├── Communities/ # Community-related components
│   ├── Editor/      # Post editor components
│   ├── Feed/        # Feed display components
│   ├── nav/         # Navigation components
│   ├── playVideo/   # Video player components
│   ├── Sidebar/     # Sidebar components
│   ├── studio/      # Creator studio components
│   └── ...
├── context/         # React context providers
├── graphql/         # GraphQL queries
├── hive-api/        # Hive blockchain API utilities
├── hooks/           # Custom React hooks
├── lib/             # Libraries (Apollo client, Zustand store)
├── page/            # Page components
├── redux/           # Redux store and reducers
└── utils/           # Utility functions
```

## Development

### Code Style

- Use functional components with hooks
- Follow React best practices
- SCSS for styling with BEM-like naming

### Branch Naming

- `feat/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation updates
- `refactor/` - Code refactoring
- `chore/` - Maintenance tasks

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation
- `style:` - Formatting
- `refactor:` - Code refactoring
- `test:` - Tests
- `chore:` - Maintenance

## Known Issues

- **Vite Dev Server**: The development server may crash due to Buffer polyfill timing issues with `keychain-sdk`. Use `npm run build && npm run preview` as a workaround.

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request

## Related Projects

- [3Speak Backend](https://github.com/3speaknetwork) - API services
- [@snapie/renderer](https://www.npmjs.com/package/@snapie/renderer) - Hive markdown renderer
- [@snapie/operations](https://www.npmjs.com/package/@snapie/operations) - Hive operation builder

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Links

- 🌐 [3Speak.tv](https://3speak.tv)
- 💬 [Discord](https://discord.gg/3speak)
- 🐦 [Twitter](https://twitter.com/3aboratories)
- 📝 [Hive Blog](https://peakd.com/@threespeak)

---

<p align="center">
  Built with ❤️ by the 3Speak team and contributors
</p>
