# UKSimRacing League Results Tool

A comprehensive league management system for iRacing leagues, featuring championship standings, penalty management, and configurable points systems.

## 🚀 Quick Start

### Using Docker (Recommended)
```bash
docker-compose up --build
```

### Manual Installation
```bash
npm install
npm start
```

## 📁 Project Structure

```
├── config/
│   └── database.js          # Database configuration & SQLite setup
├── middleware/
│   └── auth.js              # Authentication middleware
├── utils/
│   ├── iracing-api.js       # iRacing API utilities & authentication
│   ├── points-config.js     # Points configuration management
│   └── penalties.js         # Penalty management utilities
├── routes/
│   ├── auth.js              # Authentication endpoints
│   ├── league.js            # League search, info, seasons, roster
│   ├── results.js           # Session results
│   ├── points-config.js     # Points configuration endpoints
│   ├── penalties.js         # Penalty management endpoints
│   └── championship.js      # Championship standings calculation
├── public/                  # Frontend files
├── data/                    # SQLite database storage
├── uploads/                 # File upload storage
└── server.js               # Main Express server
```

## 🔧 Features

### Core Functionality
- **iRacing API Integration**: Secure authentication and data fetching
- **League Management**: Search leagues, view seasons, manage rosters
- **Championship Standings**: Automated calculation with division support
- **Penalty System**: Apply and manage penalties with database persistence
- **Points Configuration**: Flexible points systems with presets

### Advanced Features
- **Drop Weeks**: Configurable number of worst results to drop
- **Fastest Lap Bonus**: Award extra points for fastest lap
- **Pole Position Bonus**: Award extra points for pole position
- **Division Support**: Separate championships per division
- **Database Persistence**: SQLite with in-memory fallback

## 🏁 API Endpoints

### Authentication
- `POST /api/auth` - Login with iRacing credentials
- `GET /api/auth/status` - Check authentication status
- `POST /api/auth/logout` - Logout

### League Management
- `GET /api/league/search?search=term` - Search leagues
- `GET /api/league/:leagueId` - Get league information
- `GET /api/league/:leagueId/seasons` - Get league seasons
- `GET /api/league/:leagueId/roster` - Get league roster
- `GET /api/league/:leagueId/season/:seasonId/sessions` - Get season sessions

### Results & Championships
- `GET /api/results/:subsessionId` - Get session results
- `GET /api/league/:leagueId/season/:seasonId/championship` - Get championship standings

### Configuration
- `GET /api/league/:leagueId/points-config` - Get points configuration
- `POST /api/league/:leagueId/points-config` - Save points configuration

### Penalties
- `GET /api/league/:leagueId/season/:seasonId/penalties` - Get penalties
- `POST /api/league/:leagueId/season/:seasonId/penalties` - Add penalty
- `DELETE /api/league/:leagueId/season/:seasonId/penalties/:subsessionId/:custId` - Remove penalty

## 🎯 Points System Presets

### Standard Championship
- Positions 1-15: 30, 28, 26, 24, 22, 20, 18, 16, 14, 12, 10, 8, 6, 4, 2
- Drop weeks: 2
- Fastest lap: 1 point
- Pole position: 1 point

### F1 Style
- Positions 1-10: 25, 18, 15, 12, 10, 8, 6, 4, 2, 1
- Drop weeks: 2
- Fastest lap: 1 point
- Pole position: 1 point

### IndyCar Style
- Positions 1-20: 50, 40, 35, 32, 30, 28, 26, 24, 22, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10
- Drop weeks: 1
- Fastest lap: 0 points
- Pole position: 1 point

### NASCAR Style
- Positions 1-20: 40, 35, 34, 33, 32, 31, 30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17
- Drop weeks: 2
- Fastest lap: 1 point
- Pole position: 1 point

## 🔒 Environment Variables

```bash
PORT=3000                    # Server port (default: 3000)
NODE_ENV=production          # Environment mode
```

## 🐳 Docker Configuration

The application is containerized with Docker for easy deployment:

```yaml
# docker-compose.yaml
version: '3.8'
services:
  uksimracing:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
      - ./uploads:/app/uploads
```

## 🗃️ Database

- **Primary**: SQLite database stored in `./data/league_data.db`
- **Fallback**: In-memory storage if SQLite fails
- **Tables**: 
  - `points_configs` - League points configurations
  - `penalties` - Applied penalties by league/season

## 🛠️ Development

### File Structure Guidelines
- **Routes**: API endpoint handlers in `/routes`
- **Utils**: Reusable utility functions in `/utils`
- **Config**: Configuration and setup in `/config`
- **Middleware**: Express middleware in `/middleware`

### Adding New Features
1. Create utility functions in `/utils` if needed
2. Add route handlers in `/routes`
3. Import and mount routes in `server.js`
4. Update this README with new endpoints

## 📝 License

MIT License - see LICENSE file for details

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 🆘 Support

For issues and support, please create an issue in the GitHub repository. 