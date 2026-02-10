const chalk = require('chalk');
const Table = require('cli-table3');
const ora = require('ora');
const fs = require('fs');
const path = require('path');
const chrono = require('chrono-node');
const crypto = require('crypto');

// Reminder storage
const CONFIG_DIR = path.join(process.env.HOME, '.config', 'brain-cli');
const REMINDERS_FILE = path.join(CONFIG_DIR, 'reminders.json');

// Cron integration
const CRON_DIR = path.join(process.env.HOME, '.clawdbot', 'cron');
const CRON_FILE = path.join(CRON_DIR, 'jobs.json');

// Default Discord channel for reminders
const DISCORD_CHANNEL = '1466328752525938689';

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadReminders() {
  if (!fs.existsSync(REMINDERS_FILE)) {
    return { reminders: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(REMINDERS_FILE, 'utf8'));
  } catch {
    return { reminders: [] };
  }
}

function saveReminders(data) {
  ensureConfigDir();
  data.lastUpdated = new Date().toISOString();
  fs.writeFileSync(REMINDERS_FILE, JSON.stringify(data, null, 2));
}

function generateId() {
  return crypto.randomBytes(4).toString('hex');
}

function formatRelativeTime(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = date - now;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMs < 0) return chalk.red('overdue');
  if (diffDays > 0) return `in ${diffDays}d ${diffHours % 24}h`;
  if (diffHours > 0) return `in ${diffHours}h ${diffMin % 60}m`;
  return `in ${diffMin}m`;
}

// Load and update cron jobs file to include/remove reminder entries
function loadCronJobs() {
  if (!fs.existsSync(CRON_FILE)) {
    return { jobs: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(CRON_FILE, 'utf8'));
  } catch {
    return { jobs: [] };
  }
}

function saveCronJobs(data) {
  if (!fs.existsSync(CRON_DIR)) {
    fs.mkdirSync(CRON_DIR, { recursive: true });
  }
  fs.writeFileSync(CRON_FILE, JSON.stringify(data, null, 2));
}

function addCronEntry(reminder) {
  const cronData = loadCronJobs();
  const cronId = `brain-reminder-${reminder.id}`;

  // Remove existing entry if any
  cronData.jobs = cronData.jobs.filter(j => j.name !== cronId);

  cronData.jobs.push({
    name: cronId,
    enabled: true,
    type: 'reminder',
    source: 'brain-cli',
    description: `Reminder: ${reminder.taskName}`,
    discordChannel: reminder.discordChannel || DISCORD_CHANNEL,
    message: `⏰ **Reminder:** ${reminder.taskName}${reminder.notionUrl ? `\n📎 ${reminder.notionUrl}` : ''}`,
    state: {
      nextRunAtMs: new Date(reminder.remindAt).getTime(),
      lastStatus: null,
      lastError: null
    }
  });

  saveCronJobs(cronData);
}

function removeCronEntry(reminderId) {
  const cronData = loadCronJobs();
  const cronId = `brain-reminder-${reminderId}`;
  cronData.jobs = cronData.jobs.filter(j => j.name !== cronId);
  saveCronJobs(cronData);
}

/**
 * Register the 'remind' subcommand group on the given commander program.
 * Requires notionRequest and helpers from the main cli.
 */
function register(program, { notionRequest, getPlainText, DATABASES, parseDate, loadCache, getCacheAge }) {
  const remind = program.command('remind').description('Manage task reminders via cron');

  // --- brain remind list ---
  remind.command('list')
    .description('List active reminders')
    .action(async () => {
      const data = loadReminders();
      const active = data.reminders.filter(r => r.status === 'active');

      if (active.length === 0) {
        console.log(chalk.dim('No active reminders. Create one with `brain remind create`'));
        return;
      }

      const table = new Table({
        head: ['ID', 'Task', 'Remind At', 'Countdown'].map(h => chalk.cyan.bold(h)),
        style: { head: [], border: [] }
      });

      const now = new Date();
      active
        .sort((a, b) => new Date(a.remindAt) - new Date(b.remindAt))
        .forEach(r => {
          const isPast = new Date(r.remindAt) < now;
          table.push([
            chalk.yellow(r.id),
            r.taskName.substring(0, 50) + (r.taskName.length > 50 ? '...' : ''),
            isPast ? chalk.red(r.remindAt) : r.remindAt,
            formatRelativeTime(r.remindAt)
          ]);
        });

      console.log(chalk.bold('\n⏰ Active Reminders\n'));
      console.log(table.toString());
      console.log(chalk.dim(`\nTotal: ${active.length} reminders`));
      console.log(chalk.dim(`Storage: ${REMINDERS_FILE}`));
    });

  // --- brain remind create <when> ---
  remind.command('create [when]')
    .description('Create a reminder for a task (interactive: picks from tasks with due dates)')
    .option('-t, --task <id>', 'Notion task short ID (skip interactive selection)')
    .option('-m, --message <msg>', 'Custom reminder message (creates reminder without Notion task)')
    .option('-c, --channel <id>', 'Discord channel ID', DISCORD_CHANNEL)
    .action(async (when, options) => {
      try {
        // Custom message mode: no Notion lookup needed
        if (options.message) {

          const remindAt = resolveWhen(when);
          if (!remindAt) {
            console.error(chalk.red('Could not parse reminder time. Use natural language like "tomorrow 9am" or "in 2 hours"'));
            return;
          }

          const reminder = {
            id: generateId(),
            taskName: options.message,
            taskId: null,
            notionUrl: null,
            remindAt: remindAt.toISOString(),
            discordChannel: options.channel,
            status: 'active',
            createdAt: new Date().toISOString()
          };

          const data = loadReminders();
          data.reminders.push(reminder);
          saveReminders(data);
          addCronEntry(reminder);

          console.log(chalk.green(`✓ Reminder created: ${reminder.taskName}`));
          console.log(chalk.dim(`  ID: ${reminder.id}`));
          console.log(chalk.dim(`  When: ${reminder.remindAt} (${formatRelativeTime(reminder.remindAt)})`));
          console.log(chalk.dim(`  Channel: #${reminder.discordChannel}`));
          return;
        }

        // Fetch tasks with due dates from Notion
        const spinner = ora('Fetching tasks with due dates...').start();
        const response = await notionRequest('POST', `/v1/databases/${DATABASES.tasks}/query`, {
          filter: {
            and: [
              { property: 'Status', select: { does_not_equal: 'Done' } },
              { property: 'Due Date', date: { is_not_empty: true } }
            ]
          },
          sorts: [{ property: 'Due Date', direction: 'ascending' }]
        });

        spinner.stop();

        if (response.results.length === 0) {
          console.log(chalk.dim('No tasks with due dates found.'));
          console.log(chalk.dim('Use --message to create a standalone reminder.'));
          return;
        }

        // If --task flag given, find that specific task
        let selectedTask;
        if (options.task) {
          selectedTask = response.results.find(p => p.id.startsWith(options.task));
          if (!selectedTask) {
            console.error(chalk.red(`Task not found with ID starting with: ${options.task}`));
            return;
          }
        } else {
          // Show tasks and let user pick
          console.log(chalk.bold('\n📋 Tasks with due dates:\n'));

          const table = new Table({
            head: ['#', 'ID', 'Task', 'Due Date', 'Status'].map(h => chalk.cyan.bold(h)),
            style: { head: [], border: [] }
          });

          const today = new Date().toISOString().split('T')[0];
          response.results.forEach((page, i) => {
            const props = page.properties;
            const shortId = page.id.split('-')[0];
            const task = getPlainText(props.Task?.title);
            const dueDate = props['Due Date']?.date?.start || '-';
            const status = props.Status?.select?.name || '-';
            const isOverdue = dueDate !== '-' && dueDate < today;

            table.push([
              chalk.dim(`${i + 1}`),
              chalk.yellow(shortId),
              isOverdue ? chalk.red(task) : task,
              isOverdue ? chalk.red(dueDate) : dueDate,
              status
            ]);
          });

          console.log(table.toString());
          console.log(chalk.dim(`\nUse: brain remind create <when> --task <ID>`));
          console.log(chalk.dim('Example: brain remind create "1 hour before" --task ' + response.results[0].id.split('-')[0]));
          return;
        }

        // We have a selected task - create reminder
        const taskName = getPlainText(selectedTask.properties.Task?.title);
        const dueDate = selectedTask.properties['Due Date']?.date?.start;
        const notionUrl = `https://notion.so/${selectedTask.id.replace(/-/g, '')}`;

        let remindAt;
        if (when) {
          remindAt = resolveWhen(when, dueDate);
        } else if (dueDate) {
          // Default: remind at 9 AM on the due date
          remindAt = new Date(dueDate + 'T09:00:00');
          if (remindAt < new Date()) {
            // Due date is today or past, remind in 30 min
            remindAt = new Date(Date.now() + 30 * 60 * 1000);
          }
        }

        if (!remindAt) {
          console.error(chalk.red('Could not determine reminder time. Specify a time like "tomorrow 9am" or "in 2 hours"'));
          return;
        }

        const reminder = {
          id: generateId(),
          taskName,
          taskId: selectedTask.id,
          notionUrl,
          dueDate,
          remindAt: remindAt.toISOString(),
          discordChannel: options.channel,
          status: 'active',
          createdAt: new Date().toISOString()
        };

        const data = loadReminders();
        data.reminders.push(reminder);
        saveReminders(data);
        addCronEntry(reminder);

        console.log(chalk.green(`✓ Reminder created for: ${taskName}`));
        console.log(chalk.dim(`  ID: ${reminder.id}`));
        console.log(chalk.dim(`  Due: ${dueDate}`));
        console.log(chalk.dim(`  Remind: ${reminder.remindAt} (${formatRelativeTime(reminder.remindAt)})`));
        console.log(chalk.dim(`  Notion: ${notionUrl}`));
        console.log(chalk.dim(`  Channel: #${reminder.discordChannel}`));
      } catch (error) {
        if (typeof spinner !== 'undefined') spinner.fail(chalk.red('Failed to create reminder'));
        else console.error(chalk.red('Failed to create reminder'));
        console.error(chalk.dim(error.message));
      }
    });

  // --- brain remind cancel <id> ---
  remind.command('cancel <id>')
    .description('Cancel a reminder by ID')
    .action(async (id) => {
      const data = loadReminders();
      const reminder = data.reminders.find(r => r.id === id && r.status === 'active');

      if (!reminder) {
        console.error(chalk.red(`No active reminder found with ID: ${id}`));
        return;
      }

      reminder.status = 'cancelled';
      reminder.cancelledAt = new Date().toISOString();
      saveReminders(data);
      removeCronEntry(id);

      console.log(chalk.green(`✓ Cancelled reminder: ${reminder.taskName}`));
      console.log(chalk.dim(`  Was scheduled for: ${reminder.remindAt}`));
    });

  // --- brain remind scan ---
  remind.command('scan')
    .description('Scan Notion tasks and suggest reminders for upcoming due dates')
    .option('--auto', 'Automatically create reminders for all tasks due within 7 days')
    .action(async (options) => {
      const spinner = ora('Scanning tasks for upcoming due dates...').start();
      try {
        const today = new Date();
        const weekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        const response = await notionRequest('POST', `/v1/databases/${DATABASES.tasks}/query`, {
          filter: {
            and: [
              { property: 'Status', select: { does_not_equal: 'Done' } },
              { property: 'Due Date', date: { on_or_before: weekFromNow } },
              { property: 'Due Date', date: { is_not_empty: true } }
            ]
          },
          sorts: [{ property: 'Due Date', direction: 'ascending' }]
        });

        spinner.stop();

        if (response.results.length === 0) {
          console.log(chalk.dim('No tasks due within the next 7 days.'));
          return;
        }

        // Check which tasks already have reminders
        const existing = loadReminders();
        const activeTaskIds = new Set(
          existing.reminders
            .filter(r => r.status === 'active')
            .map(r => r.taskId)
        );

        const needsReminder = response.results.filter(p => !activeTaskIds.has(p.id));

        if (needsReminder.length === 0) {
          console.log(chalk.green('✓ All upcoming tasks already have reminders.'));
          return;
        }

        console.log(chalk.bold(`\n📅 ${needsReminder.length} tasks due soon without reminders:\n`));

        const table = new Table({
          head: ['ID', 'Task', 'Due Date', 'Status'].map(h => chalk.cyan.bold(h)),
          style: { head: [], border: [] }
        });

        const todayStr = today.toISOString().split('T')[0];
        needsReminder.forEach(page => {
          const props = page.properties;
          const shortId = page.id.split('-')[0];
          const task = getPlainText(props.Task?.title);
          const dueDate = props['Due Date']?.date?.start || '-';
          const status = props.Status?.select?.name || '-';
          const isOverdue = dueDate < todayStr;

          table.push([
            chalk.yellow(shortId),
            isOverdue ? chalk.red(task) : task,
            isOverdue ? chalk.red(dueDate) : dueDate,
            status
          ]);
        });

        console.log(table.toString());

        if (options.auto) {
          // Auto-create reminders: 9 AM on due date (or 30 min from now if overdue/today)
          let created = 0;
          for (const page of needsReminder) {
            const taskName = getPlainText(page.properties.Task?.title);
            const dueDate = page.properties['Due Date']?.date?.start;
            const notionUrl = `https://notion.so/${page.id.replace(/-/g, '')}`;

            let remindAt = new Date(dueDate + 'T09:00:00');
            if (remindAt < today) {
              remindAt = new Date(Date.now() + 30 * 60 * 1000);
            }

            const reminder = {
              id: generateId(),
              taskName,
              taskId: page.id,
              notionUrl,
              dueDate,
              remindAt: remindAt.toISOString(),
              discordChannel: DISCORD_CHANNEL,
              status: 'active',
              createdAt: new Date().toISOString()
            };

            existing.reminders.push(reminder);
            addCronEntry(reminder);
            created++;
          }

          saveReminders(existing);
          console.log(chalk.green(`\n✓ Created ${created} reminders automatically.`));
          console.log(chalk.dim('View with: brain remind list'));
        } else {
          console.log(chalk.dim('\nCreate reminders with: brain remind create <when> --task <ID>'));
          console.log(chalk.dim('Or auto-create all: brain remind scan --auto'));
        }
      } catch (error) {
        spinner.fail(chalk.red('Failed to scan tasks'));
        console.error(chalk.dim(error.message));
      }
    });

  // --- brain remind clean ---
  remind.command('clean')
    .description('Remove expired and cancelled reminders')
    .action(async () => {
      const data = loadReminders();
      const now = new Date();
      const before = data.reminders.length;

      // Mark expired reminders
      data.reminders.forEach(r => {
        if (r.status === 'active' && new Date(r.remindAt) < now) {
          r.status = 'expired';
          removeCronEntry(r.id);
        }
      });

      // Remove non-active reminders
      data.reminders = data.reminders.filter(r => r.status === 'active');
      saveReminders(data);

      const removed = before - data.reminders.length;
      console.log(chalk.green(`✓ Cleaned up ${removed} expired/cancelled reminders.`));
      console.log(chalk.dim(`Remaining active: ${data.reminders.length}`));
    });

  return remind;
}

/**
 * Parse a "when" string into a Date.
 * Supports: natural language ("tomorrow 9am", "in 2 hours"),
 * relative to a due date ("1 hour before", "30 min before"),
 * or ISO dates.
 */
function resolveWhen(whenStr, dueDateStr) {
  if (!whenStr) return null;

  // "X before" pattern - relative to due date
  const beforeMatch = whenStr.match(/^(.+?)\s+before$/i);
  if (beforeMatch && dueDateStr) {
    const dueDate = new Date(dueDateStr + 'T09:00:00');
    const offsetParsed = chrono.parseDate(beforeMatch[1] + ' from now');
    if (offsetParsed) {
      const offsetMs = offsetParsed - new Date();
      return new Date(dueDate.getTime() - offsetMs);
    }
  }

  // Try chrono natural language
  const parsed = chrono.parseDate(whenStr);
  if (parsed) return parsed;

  // Try ISO format
  const iso = new Date(whenStr);
  if (!isNaN(iso.getTime())) return iso;

  return null;
}

module.exports = { register };
