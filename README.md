# Brain CLI 🧠

A delightful command-line interface for interacting with the Notion Brain System.

## Installation

```bash
npm install -g
```

Or use directly:
```bash
npm install
npm link
```

## Configuration

Brain CLI expects your Notion API key at:
```
~/.config/notion/api_key
```

## Usage

### Add Items

**Add an idea:**
```bash
brain add idea "Build a rocket ship"
brain add idea "Learn quantum physics" --desc "Start with the basics" --priority high
```

**Add a task:**
```bash
brain add task "Buy groceries"
brain add task "Finish report" --due "next friday" --notes "Include Q4 metrics"
brain add task "Call dentist" --due tomorrow
```

**Add a note:**
```bash
brain add note "Meeting Notes" --summary "Discussed Q1 roadmap" --source "Team Sync"
```

**Add a decision:**
```bash
brain add decision "Use TypeScript for new project" \
  --context "Team wants better type safety" \
  --alternatives "Plain JavaScript, ReScript"
```

**Add a project:**
```bash
brain add project "Website Redesign" --goal "Improve conversion rate by 20%"
```

### List Items

```bash
brain list tasks                    # Show active tasks
brain list tasks --status done      # Show completed tasks
brain list tasks --overdue          # Show overdue tasks only

brain list ideas                    # Show all ideas
brain list ideas --status new       # Show new ideas only

brain list notes --limit 5          # Show 5 most recent notes
brain list projects                 # Show active projects
```

### Quick Views

```bash
brain show          # Show all active tasks in a nice table
brain summary       # Overview of tasks, ideas, and projects
```

### Complete Tasks

```bash
brain done 2f77a821           # By ID (short form works)
brain done "buy groceries"    # By title (fuzzy match)
```

## Features

- ✨ **Beautiful output** - Colored tables and spinners
- 📅 **Smart dates** - Use natural language ("tomorrow", "next monday")
- 🎯 **Fuzzy matching** - Find tasks by partial title
- ⚡ **Fast** - Direct Notion API calls, no bloat
- 🧠 **Smart defaults** - New ideas start as "New", tasks as "Todo"

## Examples

```bash
# Morning routine
brain summary
brain show

# Quick task add
brain add task "Review PRs" --due today

# Mark something done
brain done "review prs"

# Check what's overdue
brain list tasks --overdue

# Capture an idea
brain add idea "AI-powered todo assistant" --priority high

# Log a decision
brain add decision "Switch to pnpm" \
  --context "npm workspaces are slow" \
  --alternatives "yarn, npm"
```

## Database Structure

Brain CLI works with these Notion databases:
- 💡 **Ideas** - Capture thoughts and inspiration
- ✅ **Tasks** - Track what needs to be done
- 📝 **Notes** - Store knowledge and insights
- ⚖️ **Decisions** - Document important choices
- 📂 **Projects** - Manage larger initiatives

All items created via Brain CLI are tagged with "Created by Claude" for easy filtering.

## License

MIT

---

*"Brain the size of a planet, and they ask me to manage a todo list. Call that job satisfaction? 'Cause I don't."*
