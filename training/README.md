# 🧠 Docent Custom Model & Training Pipeline

This folder contains the complete toolchain to train, fine-tune, and package your own custom **Docent** model so you can run it **100% locally and privately with zero API keys or cloud billing**.

---

## ⚡ Quickstart: Run a Free Local Model Right Away (No Training Needed)

If you just want to run Docent locally without training right now:

1. **Install [Ollama](https://ollama.com/)** (Windows, macOS, or Linux).
2. **Pull the base coding model**:
   ```bash
   ollama pull qwen2.5-coder:1.5b
   ```
   *(Or for heavier GPU: `ollama pull qwen2.5-coder:7b` or `ollama pull llama3.2:3b`)*
3. **Package it with Docent's persona**:
   ```bash
   cd training
   ollama create docent-custom -f Modelfile
   ```
4. **Select Local Provider in VS Code**:
   - Open VS Code Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
   - Run **`Docent: Select LLM Provider`** and pick **`Local Custom Model`**.
   - You're done! Docent is now 100% powered by your local machine.

---

## 🛠️ Step-by-Step Custom Training & Fine-Tuning Guide

If you want to train and fine-tune your own weights from scratch:

### Step 1: Generate Training Dataset
You can generate a synthetic dataset matching Docent's persona or extract examples directly from your favorite repositories:

```bash
# Generate 250+ synthetic training pairs:
python dataset_generator.py --synthetic --count 300 --output docent_dataset.jsonl

# Or scan an existing repository:
python dataset_generator.py --repo-path /path/to/my-repo --output docent_dataset.jsonl
```

### Step 2: Fine-Tune with QLoRA
Fine-tune a lightweight 1.5B or 3B model (takes ~10-15 minutes on a free Google Colab T4 GPU or local GPU):

```bash
pip install unsloth "torch>=2.2.0" "transformers>=4.40.0" trl peft datasets bitsandbytes

python fine_tune.py --dataset docent_dataset.jsonl --base-model Qwen/Qwen2.5-Coder-1.5B-Instruct --output docent_custom_lora
```

### Step 3: Export to GGUF
The `fine_tune.py` script automatically exports quantized GGUF weights (`unsloth.Q4_K_M.gguf`) into `docent-custom-gguf/`.

### Step 4: Load into Ollama
Edit `Modelfile` to point to your exported GGUF file:
```dockerfile
FROM ./docent-custom-gguf/unsloth.Q4_K_M.gguf
```
Then create your model in Ollama:
```bash
ollama create docent-custom -f Modelfile
```

---

## 🔌 VS Code Configuration Settings

In your `settings.json` or VS Code Settings UI:

| Setting | Default | Description |
| :--- | :--- | :--- |
| `docent.llmProvider` | `"local"` | `"local"` (Ollama/custom) or `"anthropic"` (Cloud API) |
| `docent.localEndpoint` | `"http://localhost:11434"` | Local inference server URL |
| `docent.localModel` | `"docent-custom"` | Local model identifier |
| `docent.localApiFormat` | `"ollama"` | `"ollama"` or `"openai-compatible"` (for LM Studio / vLLM) |
| `docent.staticAnalysisOnly` | `false` | Enable pure offline template mode |
