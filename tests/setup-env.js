// Runs before every test file, before the app (and its env validation) is imported.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET ||= 'test-jwt-secret-test-jwt-secret-test-jwt-secret';
process.env.COOKIE_SECRET ||= 'test-cookie-secret-test-cookie-secret-123456';
process.env.MONGODB_URI ||= 'mongodb://127.0.0.1:27017/placeholder_test'; // never actually used by tests
process.env.CLIENT_URL = 'http://localhost:5173';
process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
process.env.SMTP_HOST = '';
