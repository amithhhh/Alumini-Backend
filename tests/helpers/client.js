import request from 'supertest';
import { createApp } from '../../src/app.js';

const app = createApp();

/** A cookie-persisting client that fetches a CSRF token once and attaches it to every unsafe request. */
export async function createClient() {
  const agent = request.agent(app);
  const csrf = (await agent.get('/api/auth/csrf')).body.data.csrfToken;
  const unsafe = (method) => (url) => agent[method](url).set('X-CSRF-Token', csrf);
  return {
    agent,
    csrf,
    get: (url) => agent.get(url),
    post: unsafe('post'),
    patch: unsafe('patch'),
    login: (email, password) => unsafe('post')('/api/auth/login').send({ email, password }),
  };
}
export { app };
