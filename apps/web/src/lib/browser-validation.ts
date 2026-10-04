import { z } from 'zod';

// Run before shared schemas: Zod's optional eval probe violates strict script CSP.
z.config({ jitless: true });
