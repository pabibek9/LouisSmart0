with open('d:/content jen-20260602T100458Z-3-001/content jen/chat.css', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for idx, line in enumerate(lines):
    if '.chat' in line or '#chat' in line:
        # Check if it's a class selector or id selector
        cleaned = line.strip()
        if cleaned.startswith('.chat') or cleaned.startswith('#chat') or ',' in cleaned or ' ' in cleaned:
            print(f"Line {idx+1}: {cleaned}")
            start = max(0, idx - 3)
            end = min(len(lines), idx + 6)
            for i in range(start, end):
                prefix = "->" if i == idx else "  "
                print(f"{prefix} {i+1}: {lines[i].strip()}")
            print("-" * 40)
