# Memory Promote

Graduate a proven pattern from agent memory into CLAUDE.md for permanent enforcement.

## Steps

### 1. Identify the Pattern
- User specifies which pattern to promote, OR
- Pick from `/memory-review --candidates` results
- Find the entry in the agent memory files
- Confirm the entry and its source with the user

### 2. Check Promotion Criteria
All 3 must be true:
- **Proven**: Appeared in 2+ sessions or corrected behavior multiple times
- **Actionable**: Can be written as a concrete instruction ("Always X", "Never Y")
- **Durable**: Will still be true in 30+ days (not session-specific or temporary)

If criteria aren't met, explain why and suggest keeping it in memory.

### 3. Determine Target Section
Find the appropriate section in CLAUDE.md for the rule. If no section fits, append to the most relevant TO-DOs section.

### 4. Distill into Prescriptive Rule
Transform from descriptive memory note to concise instruction:
- Descriptive: "We noticed that CORS errors on /api/upload are caused by the CDN"
- Prescriptive: "CORS errors on /api/upload originate from the CDN, not the backend -- debug CDN config first"

Rules for distillation:
- Imperative voice ("Use X", "Always Y", "Never Z")
- Include the specific command, path, or example -- not just the concept
- One line when possible, two lines maximum

### 5. Write to Target
- Append the rule to the appropriate section of CLAUDE.md
- If CLAUDE.md would exceed 200 lines, warn the user and suggest trimming other sections first

### 6. Clean Up Source
- Remove the promoted entry from the agent memory file
- Confirm the change with the user

### 7. Verify
- Report: what was promoted, where it went, remaining MEMORY.md capacity

## Rules
- Always confirm with the user before writing to CLAUDE.md
- Always confirm before removing from agent memory
- One promotion at a time -- never batch multiple promotions
- After promoting, suggest running `/memory-status` to verify health
