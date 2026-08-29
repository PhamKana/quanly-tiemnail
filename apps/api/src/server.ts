import { startServer } from './app';

startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exitCode = 1;
});

