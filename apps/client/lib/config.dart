/// Where the server lives. Override with --dart-define=API_URL=...
const apiUrl = String.fromEnvironment('API_URL', defaultValue: 'http://localhost:8787');

/// Shows the seeded demo accounts on the sign-in screen. Off in production builds.
const showDemoAccounts = bool.fromEnvironment('DEMO_ACCOUNTS', defaultValue: true);
