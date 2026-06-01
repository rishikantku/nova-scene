// backend/src/server.ts
import app from './index';

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`NovaScene API running on port ${PORT}`);
});
