import "dotenv/config";
import app from "./app";
import { startDbKeepAlive } from "./utils/db";

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
  startDbKeepAlive();
});
