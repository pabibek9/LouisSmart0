import re

with open('d:/content jen-20260602T100458Z-3-001/content jen/chat.css', 'r', encoding='utf-8') as f:
    lines = f.readlines()

for idx, line in enumerate(lines):
    if 'composer' in line:
        print(f"Line {idx+1}: {line.strip()}")
        # print 5 lines before and after
        start = max(0, idx - 5)
        end = min(len(lines), idx + 6)
        for i in range(start, end):
            prefix = "->" if i == idx else "  "
            print(f"{prefix} {i+1}: {lines[i].strip()}")
        print("-" * 40)
