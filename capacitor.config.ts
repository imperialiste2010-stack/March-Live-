const config = {
  appId: 'ci.marchelive.app',
  appName: 'MARCHÉ LIVE',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: '#0F5132',
    },
  },
};

export default config;
