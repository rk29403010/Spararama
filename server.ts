import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: "50mb" }));

  // API Routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Analyze Test Strip or Barcode using Gemini
  app.post("/api/analyze-image", async (req, res) => {
    try {
      const { imageBase64, type } = req.body; // type = 'barcode' or 'test_strip'
      if (!imageBase64) {
        return res.status(400).json({ error: "No image provided" });
      }
      
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "Gemini API key not configured" });
      }

      const ai = new GoogleGenAI({ 
        apiKey,
        httpOptions: {
          headers: { 'User-Agent': 'aistudio-build' }
        }
      });

      let prompt = "";
      let responseSchema: any = null;

      if (type === "barcode") {
        prompt = "Analyze this image and identify the hot tub or pool chemical. Return the name of the chemical, its primary active ingredient (e.g. Chlorine, Bromine, pH Plus), and the quantity if visible. Return as a JSON object.";
        responseSchema = {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            ingredientType: { type: Type.STRING },
            quantity: { type: Type.STRING }
          },
          required: ["name"]
        };
      } else if (type === "test_strip") {
         prompt = "Analyze this hot tub test strip. Identify the values for Free Chlorine (or Bromine), pH, and Total Alkalinity. Compare the colors to the standard chart if visible, or estimate based on standard hot tub test strips. Return the readings as numbers if possible, or null if unreadable. Return as JSON.";
         responseSchema = {
          type: Type.OBJECT,
          properties: {
            chlorine: { type: Type.NUMBER, description: "Free chlorine ppm, e.g. 3.0" },
            bromine: { type: Type.NUMBER, description: "Bromine ppm, e.g. 4.0" },
            ph: { type: Type.NUMBER, description: "pH level, e.g. 7.4" },
            alkalinity: { type: Type.NUMBER, description: "Total Alkalinity ppm, e.g. 100" }
          }
         };
      } else {
        return res.status(400).json({ error: "Invalid analysis type" });
      }

      // Remove data:image/jpeg;base64, prefix if present
      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: {
          parts: [
            { inlineData: { mimeType: "image/jpeg", data: base64Data } },
            { text: prompt }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema
        }
      });

      let resultText = response.text || "{}";
      
      try {
        const data = JSON.parse(resultText);
        res.json(data);
      } catch(e) {
         res.json({ raw: resultText });
      }
      
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message || "Failed to analyze image" });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
