#!/usr/bin/env node

const { Command } = require('commander');
const chalk = require('chalk');
const Table = require('cli-table3');
const ora = require('ora');
const fs = require('fs');
const path = require('path');
const chrono = require('chrono-node');
const https = require('https');

const program = new Command();

// Database IDs from marvin-brain skill
const DATABASES = {
  ideas: '2f77a821-c0f2-81ba-9618-c11d734e05be',
  tasks: '2f77a821-c0f2-81d6-a77b-f7c794636941',
  notes: '2f77a821-c0f2-8147-9d9a-fabe6620ef26',
  decisions: '2f77a821-c0f2-8143-a8fd-d9c286c6fea2',
  projects: '2f77a821-c0f2-8110-97f8-e487b3f0ed9f'
};

// Load Notion API key
function getNotionKey() {
  const keyPath = path.join(process.env.HOME, '.config', 'notion', 'api_key');
  if (!fs.existsSync(keyPath)) {
    console.error(chalk.red('✗ Notion API key not found'));
    console.error(chalk.dim(`Expected at: ${keyPath}`));
    process.exit(1);
  }
  return fs.readFileSync(keyPath, 'utf8').trim();
}

// Make Notion API request
function notionRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.notion.com',
      port: 443,
      path: path,
      method: method,
      headers: {
        'Authorization': `Bearer ${getNotionKey()}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(body));
        } else {
          reject(new Error(`Notion API error: ${res.statusCode} - ${body}`));
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

// Parse relative dates
function parseDate(dateStr) {
  if (!dateStr) return null;
  
  // Check if already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }
  
  // Use chrono-node for natural language dates
  const parsed = chrono.parseDate(dateStr);
  if (parsed) {
    return parsed.toISOString().split('T')[0];
  }
  
  return null;
}

// Format Notion text
function getPlainText(richText) {
  if (!richText || !Array.isArray(richText)) return '';
  return richText.map(t => t.plain_text || '').join('');
}

// Add commands
const add = program.command('add').description('Add new items to Brain');

add.command('idea <title>')
  .description('Add a new idea')
  .option('-d, --desc <description>', 'Idea description')
  .option('-p, --priority <level>', 'Priority (low|medium|high)', 'medium')
  .action(async (title, options) => {
    const spinner = ora('Adding idea...').start();
    try {
      const data = {
        parent: { database_id: DATABASES.ideas },
        properties: {
          'Name': { title: [{ text: { content: title } }] },
          'Status': { select: { name: 'New' } },
          'Priority': { select: { name: options.priority.charAt(0).toUpperCase() + options.priority.slice(1) } },
          'Created by Claude': { checkbox: true }
        }
      };
      
      if (options.desc) {
        data.properties['Description'] = { rich_text: [{ text: { content: options.desc } }] };
      }
      
      await notionRequest('POST', '/v1/pages', data);
      spinner.succeed(chalk.green(`✓ Added idea: ${title}`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to add idea'));
      console.error(chalk.dim(error.message));
    }
  });

add.command('task <title>')
  .description('Add a new task')
  .option('-d, --due <date>', 'Due date (YYYY-MM-DD or natural language)')
  .option('-n, --notes <notes>', 'Task notes')
  .action(async (title, options) => {
    const spinner = ora('Adding task...').start();
    try {
      const data = {
        parent: { database_id: DATABASES.tasks },
        properties: {
          'Task': { title: [{ text: { content: title } }] },
          'Status': { select: { name: 'Todo' } },
          'Created by Claude': { checkbox: true }
        }
      };
      
      if (options.due) {
        const dueDate = parseDate(options.due);
        if (dueDate) {
          data.properties['Due Date'] = { date: { start: dueDate } };
        }
      }
      
      if (options.notes) {
        data.properties['Notes'] = { rich_text: [{ text: { content: options.notes } }] };
      }
      
      await notionRequest('POST', '/v1/pages', data);
      spinner.succeed(chalk.green(`✓ Added task: ${title}`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to add task'));
      console.error(chalk.dim(error.message));
    }
  });

add.command('note <topic>')
  .description('Add a new note')
  .requiredOption('-s, --summary <summary>', 'Note summary')
  .option('--source <source>', 'Note source')
  .action(async (topic, options) => {
    const spinner = ora('Adding note...').start();
    try {
      const data = {
        parent: { database_id: DATABASES.notes },
        properties: {
          'Topic': { title: [{ text: { content: topic } }] },
          'Summary': { rich_text: [{ text: { content: options.summary } }] },
          'Created by Claude': { checkbox: true }
        }
      };
      
      if (options.source) {
        data.properties['Source'] = { rich_text: [{ text: { content: options.source } }] };
      }
      
      await notionRequest('POST', '/v1/pages', data);
      spinner.succeed(chalk.green(`✓ Added note: ${topic}`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to add note'));
      console.error(chalk.dim(error.message));
    }
  });

add.command('decision <decision>')
  .description('Add a new decision')
  .requiredOption('-c, --context <context>', 'Decision context')
  .option('-a, --alternatives <alternatives>', 'Alternatives considered')
  .action(async (decision, options) => {
    const spinner = ora('Adding decision...').start();
    try {
      const data = {
        parent: { database_id: DATABASES.decisions },
        properties: {
          'Decision': { title: [{ text: { content: decision } }] },
          'Date': { date: { start: new Date().toISOString().split('T')[0] } },
          'Context': { rich_text: [{ text: { content: options.context } }] },
          'Created by Claude': { checkbox: true }
        }
      };
      
      if (options.alternatives) {
        data.properties['Alternatives'] = { rich_text: [{ text: { content: options.alternatives } }] };
      }
      
      await notionRequest('POST', '/v1/pages', data);
      spinner.succeed(chalk.green(`✓ Added decision: ${decision}`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to add decision'));
      console.error(chalk.dim(error.message));
    }
  });

add.command('project <name>')
  .description('Add a new project')
  .requiredOption('-g, --goal <goal>', 'Project goal')
  .action(async (name, options) => {
    const spinner = ora('Adding project...').start();
    try {
      const data = {
        parent: { database_id: DATABASES.projects },
        properties: {
          'Project Name': { title: [{ text: { content: name } }] },
          'Goal': { rich_text: [{ text: { content: options.goal } }] },
          'Status': { select: { name: 'Active' } },
          'Created by Claude': { checkbox: true }
        }
      };
      
      await notionRequest('POST', '/v1/pages', data);
      spinner.succeed(chalk.green(`✓ Added project: ${name}`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to add project'));
      console.error(chalk.dim(error.message));
    }
  });

// List commands
const list = program.command('list').description('List items from Brain');

list.command('tasks')
  .description('List tasks')
  .option('-s, --status <status>', 'Filter by status (todo|in-progress|waiting|done)')
  .option('--overdue', 'Show only overdue tasks')
  .action(async (options) => {
    const spinner = ora('Fetching tasks...').start();
    try {
      const filter = {};
      
      if (options.status) {
        const statusMap = { 'todo': 'Todo', 'in-progress': 'In Progress', 'waiting': 'Waiting', 'done': 'Done' };
        filter.property = 'Status';
        filter.select = { equals: statusMap[options.status] || 'Todo' };
      } else if (options.overdue) {
        filter.and = [
          { property: 'Due Date', date: { before: new Date().toISOString().split('T')[0] } },
          { property: 'Status', select: { does_not_equal: 'Done' } }
        ];
      } else {
        filter.property = 'Status';
        filter.select = { does_not_equal: 'Done' };
      }
      
      const response = await notionRequest('POST', `/v1/databases/${DATABASES.tasks}/query`, {
        filter,
        sorts: [{ property: 'Due Date', direction: 'ascending' }]
      });
      
      spinner.stop();
      
      if (response.results.length === 0) {
        console.log(chalk.dim('No tasks found'));
        return;
      }
      
      const table = new Table({
        head: ['ID', 'Task', 'Status', 'Due Date'].map(h => chalk.cyan.bold(h)),
        style: { head: [], border: [] }
      });
      
      response.results.forEach(page => {
        const props = page.properties;
        const shortId = page.id.split('-')[0];
        const task = getPlainText(props.Task?.title);
        const status = props.Status?.select?.name || '-';
        const dueDate = props['Due Date']?.date?.start || '-';
        
        table.push([
          chalk.yellow(shortId),
          task,
          status === 'Done' ? chalk.green(status) : status,
          dueDate
        ]);
      });
      
      console.log(table.toString());
      console.log(chalk.dim(`\nTotal: ${response.results.length} tasks`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to fetch tasks'));
      console.error(chalk.dim(error.message));
    }
  });

list.command('ideas')
  .description('List ideas')
  .option('-s, --status <status>', 'Filter by status (new|in-progress|parked|implemented)')
  .action(async (options) => {
    const spinner = ora('Fetching ideas...').start();
    try {
      const filter = {};
      
      if (options.status) {
        const statusMap = { 'new': 'New', 'in-progress': 'In Progress', 'parked': 'Parked', 'implemented': 'Implemented' };
        filter.property = 'Status';
        filter.select = { equals: statusMap[options.status] || 'New' };
      }
      
      const response = await notionRequest('POST', `/v1/databases/${DATABASES.ideas}/query`, {
        filter: Object.keys(filter).length > 0 ? filter : undefined,
        sorts: [{ timestamp: 'created_time', direction: 'descending' }]
      });
      
      spinner.stop();
      
      if (response.results.length === 0) {
        console.log(chalk.dim('No ideas found'));
        return;
      }
      
      const table = new Table({
        head: ['ID', 'Idea', 'Status', 'Priority'].map(h => chalk.cyan.bold(h)),
        style: { head: [], border: [] }
      });
      
      response.results.forEach(page => {
        const props = page.properties;
        const shortId = page.id.split('-')[0];
        const idea = getPlainText(props.Name?.title);
        const status = props.Status?.select?.name || '-';
        const priority = props.Priority?.select?.name || '-';
        
        const priorityColor = priority === 'High' ? chalk.red : priority === 'Medium' ? chalk.yellow : chalk.dim;
        
        table.push([
          chalk.yellow(shortId),
          idea,
          status,
          priorityColor(priority)
        ]);
      });
      
      console.log(table.toString());
      console.log(chalk.dim(`\nTotal: ${response.results.length} ideas`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to fetch ideas'));
      console.error(chalk.dim(error.message));
    }
  });

list.command('notes')
  .description('List recent notes')
  .option('-l, --limit <number>', 'Number of notes to show', '10')
  .action(async (options) => {
    const spinner = ora('Fetching notes...').start();
    try {
      const response = await notionRequest('POST', `/v1/databases/${DATABASES.notes}/query`, {
        sorts: [{ timestamp: 'created_time', direction: 'descending' }],
        page_size: parseInt(options.limit)
      });
      
      spinner.stop();
      
      if (response.results.length === 0) {
        console.log(chalk.dim('No notes found'));
        return;
      }
      
      const table = new Table({
        head: ['ID', 'Topic', 'Summary'].map(h => chalk.cyan.bold(h)),
        style: { head: [], border: [] },
        colWidths: [12, 30, 60]
      });
      
      response.results.forEach(page => {
        const props = page.properties;
        const shortId = page.id.split('-')[0];
        const topic = getPlainText(props.Topic?.title);
        const summary = getPlainText(props.Summary?.rich_text).substring(0, 100);
        
        table.push([
          chalk.yellow(shortId),
          topic,
          summary + (summary.length === 100 ? '...' : '')
        ]);
      });
      
      console.log(table.toString());
      console.log(chalk.dim(`\nShowing ${response.results.length} notes`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to fetch notes'));
      console.error(chalk.dim(error.message));
    }
  });

list.command('projects')
  .description('List projects')
  .option('-s, --status <status>', 'Filter by status (active|paused|archived)')
  .action(async (options) => {
    const spinner = ora('Fetching projects...').start();
    try {
      const filter = {};
      
      if (options.status) {
        const statusMap = { 'active': 'Active', 'paused': 'Paused', 'archived': 'Archived' };
        filter.property = 'Status';
        filter.select = { equals: statusMap[options.status] || 'Active' };
      } else {
        filter.property = 'Status';
        filter.select = { equals: 'Active' };
      }
      
      const response = await notionRequest('POST', `/v1/databases/${DATABASES.projects}/query`, {
        filter
      });
      
      spinner.stop();
      
      if (response.results.length === 0) {
        console.log(chalk.dim('No projects found'));
        return;
      }
      
      const table = new Table({
        head: ['ID', 'Project', 'Goal', 'Status'].map(h => chalk.cyan.bold(h)),
        style: { head: [], border: [] },
        colWidths: [12, 30, 50, 12]
      });
      
      response.results.forEach(page => {
        const props = page.properties;
        const shortId = page.id.split('-')[0];
        const name = getPlainText(props['Project Name']?.title);
        const goal = getPlainText(props.Goal?.rich_text).substring(0, 80);
        const status = props.Status?.select?.name || '-';
        
        table.push([
          chalk.yellow(shortId),
          name,
          goal + (goal.length === 80 ? '...' : ''),
          status === 'Active' ? chalk.green(status) : status
        ]);
      });
      
      console.log(table.toString());
      console.log(chalk.dim(`\nTotal: ${response.results.length} projects`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to fetch projects'));
      console.error(chalk.dim(error.message));
    }
  });

// Show command
program
  .command('show')
  .description('Show active tasks overview')
  .action(async () => {
    const spinner = ora('Fetching active tasks...').start();
    try {
      const response = await notionRequest('POST', `/v1/databases/${DATABASES.tasks}/query`, {
        filter: { property: 'Status', select: { does_not_equal: 'Done' } },
        sorts: [{ property: 'Due Date', direction: 'ascending' }]
      });
      
      spinner.stop();
      
      if (response.results.length === 0) {
        console.log(chalk.green('✨ No active tasks! You\'re all clear.'));
        return;
      }
      
      console.log(chalk.bold(`\n📋 Active Tasks (${response.results.length})\n`));
      
      const table = new Table({
        head: ['ID', 'Task', 'Status', 'Due'].map(h => chalk.cyan.bold(h)),
        style: { head: [], border: [] }
      });
      
      const today = new Date().toISOString().split('T')[0];
      
      response.results.forEach(page => {
        const props = page.properties;
        const shortId = page.id.split('-')[0];
        const task = getPlainText(props.Task?.title);
        const status = props.Status?.select?.name || '-';
        const dueDate = props['Due Date']?.date?.start || '-';
        
        const isOverdue = dueDate !== '-' && dueDate < today;
        const dueDateFormatted = isOverdue ? chalk.red(dueDate) : dueDate;
        
        table.push([
          chalk.yellow(shortId),
          isOverdue ? chalk.red(task) : task,
          status === 'Todo' ? chalk.dim(status) : status,
          dueDateFormatted
        ]);
      });
      
      console.log(table.toString());
    } catch (error) {
      spinner.fail(chalk.red('Failed to fetch tasks'));
      console.error(chalk.dim(error.message));
    }
  });

// Done command
program
  .command('done <identifier>')
  .description('Mark a task as done (by ID or title)')
  .action(async (identifier) => {
    const spinner = ora('Marking task as done...').start();
    try {
      // First, search for the task
      let pageId = null;
      
      // Check if it's a short ID (first segment)
      if (/^[a-f0-9]{8}$/.test(identifier)) {
        const response = await notionRequest('POST', `/v1/databases/${DATABASES.tasks}/query`, {});
        const match = response.results.find(p => p.id.startsWith(identifier));
        if (match) pageId = match.id;
      } else {
        // Search by title
        const response = await notionRequest('POST', `/v1/databases/${DATABASES.tasks}/query`, {
          filter: { property: 'Status', select: { does_not_equal: 'Done' } }
        });
        const match = response.results.find(p => {
          const title = getPlainText(p.properties.Task?.title).toLowerCase();
          return title.includes(identifier.toLowerCase());
        });
        if (match) pageId = match.id;
      }
      
      if (!pageId) {
        spinner.fail(chalk.red('Task not found'));
        return;
      }
      
      // Update the task
      await notionRequest('PATCH', `/v1/pages/${pageId}`, {
        properties: { 'Status': { select: { name: 'Done' } } }
      });
      
      spinner.succeed(chalk.green('✓ Task marked as done!'));
    } catch (error) {
      spinner.fail(chalk.red('Failed to mark task as done'));
      console.error(chalk.dim(error.message));
    }
  });

// Summary command
program
  .command('summary')
  .description('Show Brain overview')
  .action(async () => {
    const spinner = ora('Generating summary...').start();
    try {
      const [tasks, ideas, projects] = await Promise.all([
        notionRequest('POST', `/v1/databases/${DATABASES.tasks}/query`, {
          filter: { property: 'Status', select: { does_not_equal: 'Done' } }
        }),
        notionRequest('POST', `/v1/databases/${DATABASES.ideas}/query`, {
          filter: { property: 'Status', select: { equals: 'New' } }
        }),
        notionRequest('POST', `/v1/databases/${DATABASES.projects}/query`, {
          filter: { property: 'Status', select: { equals: 'Active' } }
        })
      ]);
      
      spinner.stop();
      
      console.log(chalk.bold('\n🧠 Brain Summary\n'));
      console.log(`${chalk.cyan('Active Tasks:')} ${tasks.results.length}`);
      console.log(`${chalk.cyan('New Ideas:')} ${ideas.results.length}`);
      console.log(`${chalk.cyan('Active Projects:')} ${projects.results.length}\n`);
      
      // Show overdue tasks if any
      const today = new Date().toISOString().split('T')[0];
      const overdue = tasks.results.filter(t => {
        const due = t.properties['Due Date']?.date?.start;
        return due && due < today;
      });
      
      if (overdue.length > 0) {
        console.log(chalk.red.bold(`⚠️  ${overdue.length} overdue task${overdue.length > 1 ? 's' : ''}`));
        overdue.forEach(t => {
          const task = getPlainText(t.properties.Task?.title);
          const due = t.properties['Due Date']?.date?.start;
          console.log(chalk.red(`   • ${task} (${due})`));
        });
        console.log();
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to generate summary'));
      console.error(chalk.dim(error.message));
    }
  });

program
  .name('brain')
  .description('CLI for interacting with Notion Brain System')
  .version('1.0.0');

program.parse();
