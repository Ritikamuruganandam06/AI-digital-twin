import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';

// api/client.ts's buildUrl() reads import.meta.env.VITE_API_BASE_URL
// unconditionally -- no test .env file is loaded in this project (the
// real value is a deployment concern, not a test fixture), so stub a
// fixed value here once rather than having every test that touches
// apiFetch() repeat it.
vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:4000');

// Nothing else needed globally -- each test file mocks exactly the
// network boundary it touches (global.fetch, or the specific api/*.ts
// module) rather than relying on shared ambient mocks, mirroring
// backend/ai-service's own "mock only the boundary" test discipline.
