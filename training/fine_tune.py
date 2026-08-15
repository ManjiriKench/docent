"""
fine_tune.py — Docent Custom Model Fine-Tuning Pipeline

Fine-tunes a lightweight, high-performance open-source coding model
(e.g., Qwen2.5-Coder-1.5B or Llama-3.2-3B) with QLoRA on the Docent persona dataset.

Can be run:
1. Locally on any machine with an NVIDIA GPU (>= 6GB VRAM) or Apple Silicon.
2. In Google Colab on a Free T4 GPU (takes ~10-15 minutes).

Prerequisites:
  pip install unsloth "torch>=2.2.0" "transformers>=4.40.0" trl peft datasets bitsandbytes

Usage:
  python fine_tune.py --dataset docent_dataset.jsonl --output docent-model
"""

import os
import argparse

def train(
    dataset_path: str,
    base_model: str = "Qwen/Qwen2.5-Coder-1.5B-Instruct",
    output_dir: str = "docent_custom_lora",
    max_seq_length: int = 1024,
    epochs: int = 3,
    batch_size: int = 2,
    learning_rate: float = 2e-4,
    export_gguf: bool = True
):
    print("=" * 60)
    print("Docent Custom Model Fine-Tuning")
    print(f"Base Model:    {base_model}")
    print(f"Dataset:       {dataset_path}")
    print(f"Output Dir:    {output_dir}")
    print("=" * 60)

    try:
        # Check if unsloth is available (fastest option)
        from unsloth import FastLanguageModel
        from trl import SFTTrainer
        from transformers import TrainingArguments
        from datasets import load_dataset

        print("[*] Initializing FastLanguageModel with 4-bit quantization...")
        model, tokenizer = FastLanguageModel.from_pretrained(
            model_name=base_model,
            max_seq_length=max_seq_length,
            load_in_4bit=True,
        )

        print("[*] Configuring LoRA parameters...")
        model = FastLanguageModel.get_peft_model(
            model,
            r=16,
            target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
            lora_alpha=32,
            lora_dropout=0,
            bias="none",
            use_gradient_checkpointing="unsloth",
        )

        print(f"[*] Loading dataset from {dataset_path}...")
        dataset = load_dataset("json", data_files=dataset_path, split="train")

        def formatting_prompts_func(examples):
            convos = examples["messages"]
            texts = [tokenizer.apply_chat_template(convo, tokenize=False, add_generation_prompt=False) for convo in convos]
            return {"text": texts}

        dataset = dataset.map(formatting_prompts_func, batched=True)

        training_args = TrainingArguments(
            per_device_train_batch_size=batch_size,
            gradient_accumulation_steps=4,
            warmup_steps=5,
            num_train_epochs=epochs,
            learning_rate=learning_rate,
            fp16=True,
            logging_steps=10,
            optim="adamw_8bit",
            weight_decay=0.01,
            lr_scheduler_type="cosine",
            output_dir=output_dir,
            save_strategy="no",
        )

        trainer = SFTTrainer(
            model=model,
            tokenizer=tokenizer,
            train_dataset=dataset,
            dataset_text_field="text",
            max_seq_length=max_seq_length,
            dataset_num_proc=2,
            packing=False,
            args=training_args,
        )

        print("[*] Starting training...")
        trainer.train()
        print("[+] Training completed successfully!")

        # Save LoRA adapter
        model.save_pretrained(output_dir)
        tokenizer.save_pretrained(output_dir)
        print(f"[+] Saved LoRA weights to {output_dir}")

        if export_gguf:
            print("[*] Exporting model to GGUF format for Ollama (Q4_K_M quantization)...")
            try:
                model.save_pretrained_gguf("docent-custom-gguf", tokenizer, quantization_method="q4_k_m")
                print("[+] GGUF model exported to docent-custom-gguf/!")
            except Exception as e:
                print(f"[!] GGUF export note: {e}")
                print("    You can still import the LoRA weights or base model with Ollama.")

    except ImportError:
        print("[!] Unsloth not detected. Falling back to standard HuggingFace PEFT / SFTTrainer...")
        # Fallback standard training code
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer, TrainingArguments, BitsAndBytesConfig
        from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
        from trl import SFTTrainer
        from datasets import load_dataset

        bnb_config = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.float16,
        )

        tokenizer = AutoTokenizer.from_pretrained(base_model)
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token

        model = AutoModelForCausalLM.from_pretrained(
            base_model,
            quantization_config=bnb_config,
            device_map="auto"
        )
        model = prepare_model_for_kbit_training(model)

        peft_config = LoraConfig(
            r=16,
            lora_alpha=32,
            lora_dropout=0.05,
            bias="none",
            task_type="CAUSAL_LM",
            target_modules=["q_proj", "k_proj", "v_proj", "o_proj"]
        )
        model = get_peft_model(model, peft_config)

        dataset = load_dataset("json", data_files=dataset_path, split="train")

        def formatting_func(examples):
            convos = examples["messages"]
            texts = [tokenizer.apply_chat_template(convo, tokenize=False, add_generation_prompt=False) for convo in convos]
            return {"text": texts}

        dataset = dataset.map(formatting_func, batched=True)

        training_args = TrainingArguments(
            per_device_train_batch_size=batch_size,
            gradient_accumulation_steps=4,
            warmup_steps=5,
            num_train_epochs=epochs,
            learning_rate=learning_rate,
            fp16=torch.cuda.is_available(),
            logging_steps=10,
            output_dir=output_dir,
            save_strategy="no",
        )

        trainer = SFTTrainer(
            model=model,
            tokenizer=tokenizer,
            train_dataset=dataset,
            dataset_text_field="text",
            max_seq_length=max_seq_length,
            args=training_args,
        )

        print("[*] Starting standard SFT training...")
        trainer.train()
        model.save_pretrained(output_dir)
        tokenizer.save_pretrained(output_dir)
        print(f"[+] Saved fine-tuned model to {output_dir}")

def main():
    parser = argparse.ArgumentParser(description="Fine-tune Docent Custom Model.")
    parser.add_argument("--dataset", type=str, default="docent_dataset.jsonl", help="Path to training jsonl")
    parser.add_argument("--base-model", type=str, default="Qwen/Qwen2.5-Coder-1.5B-Instruct", help="Hugging Face base model")
    parser.add_argument("--output", type=str, default="docent_custom_lora", help="Output directory for weights")
    parser.add_argument("--epochs", type=int, default=3, help="Number of epochs")
    parser.add_argument("--batch-size", type=int, default=2, help="Per-device batch size")
    args = parser.parse_args()

    train(
        dataset_path=args.dataset,
        base_model=args.base_model,
        output_dir=args.output,
        epochs=args.epochs,
        batch_size=args.batch_size
    )

if __name__ == "__main__":
    main()
