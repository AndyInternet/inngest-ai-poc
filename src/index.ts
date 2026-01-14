import express from 'express';
import { serve } from 'inngest/express';
import { inngest } from './inngest/client';
import { functions } from './inngest/functions';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use(
  '/api/inngest',
  serve({
    client: inngest,
    functions: functions,
  })
);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
