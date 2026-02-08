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

// Cache paths
const CACHE_DIR = path.join(process.env.HOME, '.cache', 'brain-cli');
const CACHE_FILE = path.join(CACHE_DIR, 'sync.json');

// Ensure cache directory exists
function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

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

// Load cached data
function loadCache() {
  if (!fs.existsSync(CACHE_FILE)) {
    return null;
  }
  try {
    const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    return data;
  } catch (error) {
    return null;
  }
}

// Save data to cache
function saveCache(data) {
  ensureCacheDir();
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
}

// Get cache age
function getCacheAge() {
  if (!fs.existsSync(CACHE_FILE)) {
    return null;
  }
  const stats = fs.statSync(CACHE_FILE);
  const ageMs = Date.now() - stats.mtime.getTime();
  const ageMin = Math.floor(ageMs / 60000);
  const ageHours = Math.floor(ageMin / 60);
  const ageDays = Math.floor(ageHours / 24);
  
  if (ageDays > 0) return `${ageDays}d ago`;
  if (ageHours > 0) return `${ageHours}h ago`;
  return `${ageMin}m ago`;
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

// Sync command - download all data
program
  .command('sync')
  .description('Sync Brain data to local cache for offline access')
  .action(async () => {
    const spinner = ora('Syncing Brain data...').start();
    try {
      const syncData = {
        timestamp: new Date().toISOString(),
        databases: {}
      };
      
      let totalItems = 0;
      
      for (const [name, id] of Object.entries(DATABASES)) {
        spinner.text = `Syncing ${name}...`;
        const response = await notionRequest('POST', `/v1/databases/${id}/query`, {
          page_size: 100
        });
        syncData.databases[name] = response.results;
        totalItems += response.results.length;
      }
      
      saveCache(syncData);
      spinner.succeed(chalk.green('✓ Sync complete!'));
      
      console.log(chalk.dim('\nSynced items:'));
      for (const [name, items] of Object.entries(syncData.databases)) {
        console.log(`  ${chalk.cyan(name)}: ${items.length}`);
      }
      console.log(chalk.dim(`\nTotal: ${totalItems} items`));
      console.log(chalk.dim(`Cache: ${CACHE_FILE}`));
    } catch (error) {
      spinner.fail(chalk.red('Sync failed'));
      console.error(chalk.dim(error.message));
      process.exit(1);
    }
  });

// Daily briefing command
program
  .command('daily')
  .description('Daily briefing: tasks, ideas, and projects')
  .action(async () => {
    const spinner = ora('Preparing daily briefing...').start();
    try {
      const [tasks, ideas, projects] = await Promise.all([
        notionRequest('POST', `/v1/databases/${DATABASES.tasks}/query`, {
          filter: { property: 'Status', select: { does_not_equal: 'Done' } },
          sorts: [{ property: 'Due Date', direction: 'ascending' }]
        }),
        notionRequest('POST', `/v1/databases/${DATABASES.ideas}/query`, {
          filter: { property: 'Status', select: { equals: 'New' } },
          sorts: [{ timestamp: 'created_time', direction: 'descending' }],
          page_size: 10
        }),
        notionRequest('POST', `/v1/databases/${DATABASES.projects}/query`, {
          filter: { property: 'Status', select: { equals: 'Active' } }
        })
      ]);
      
      spinner.stop();
      
      const today = new Date().toISOString().split('T')[0];
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      
      console.log(chalk.bold('\n🌅 Daily Briefing\n'));
      
      // Tasks section
      console.log(chalk.bold.cyan('📋 Tasks'));
      if (tasks.results.length === 0) {
        console.log(chalk.dim('  No active tasks\n'));
      } else {
        const overdueTasks = tasks.results.filter(t => {
          const due = t.properties['Due Date']?.date?.start;
          return due && due < today;
        });
        
        const todayTasks = tasks.results.filter(t => {
          const due = t.properties['Due Date']?.date?.start;
          return due === today;
        });
        
        const upcomingTasks = tasks.results.filter(t => {
          const due = t.properties['Due Date']?.date?.start;
          return due && due > today;
        }).slice(0, 5);
        
        if (overdueTasks.length > 0) {
          console.log(chalk.red.bold(`  ⚠️  ${overdueTasks.length} overdue:`));
          overdueTasks.forEach(t => {
            const task = getPlainText(t.properties.Task?.title);
            const due = t.properties['Due Date']?.date?.start;
            console.log(chalk.red(`     • ${task} (${due})`));
          });
        }
        
        if (todayTasks.length > 0) {
          console.log(chalk.yellow(`  📅 ${todayTasks.length} due today:`));
          todayTasks.forEach(t => {
            const task = getPlainText(t.properties.Task?.title);
            console.log(chalk.yellow(`     • ${task}`));
          });
        }
        
        if (upcomingTasks.length > 0) {
          console.log(chalk.dim(`  📆 ${upcomingTasks.length} upcoming:`));
          upcomingTasks.forEach(t => {
            const task = getPlainText(t.properties.Task?.title);
            const due = t.properties['Due Date']?.date?.start || 'no date';
            console.log(chalk.dim(`     • ${task} (${due})`));
          });
        }
        
        console.log();
      }
      
      // Ideas section
      console.log(chalk.bold.cyan('💡 Recent Ideas'));
      const recentIdeas = ideas.results.filter(i => i.created_time > sevenDaysAgo);
      if (recentIdeas.length === 0) {
        console.log(chalk.dim('  No new ideas in last 7 days\n'));
      } else {
        recentIdeas.slice(0, 5).forEach(i => {
          const idea = getPlainText(i.properties.Name?.title);
          const priority = i.properties.Priority?.select?.name || 'Medium';
          const priorityColor = priority === 'High' ? chalk.red : priority === 'Medium' ? chalk.yellow : chalk.dim;
          console.log(`  ${priorityColor('●')} ${idea}`);
        });
        console.log();
      }
      
      // Projects section
      console.log(chalk.bold.cyan('📂 Active Projects'));
      if (projects.results.length === 0) {
        console.log(chalk.dim('  No active projects\n'));
      } else {
        projects.results.forEach(p => {
          const name = getPlainText(p.properties['Project Name']?.title);
          const goal = getPlainText(p.properties.Goal?.rich_text);
          console.log(`  ${chalk.green('●')} ${name}`);
          if (goal) {
            console.log(chalk.dim(`     ${goal.substring(0, 80)}${goal.length > 80 ? '...' : ''}`));
          }
        });
        console.log();
      }
      
      console.log(chalk.dim('Brain the size of a planet, managing your todo list. Call that job satisfaction? \'Cause I don\'t.\n'));
    } catch (error) {
      spinner.fail(chalk.red('Failed to generate briefing'));
      console.error(chalk.dim(error.message));
      
      // Try offline mode
      const cache = loadCache();
      if (cache) {
        console.log(chalk.yellow('\n⚠️  Using cached data (offline mode)'));
        console.log(chalk.dim(`Last sync: ${getCacheAge()}\n`));
        // Fall back to showing cached summary
      }
    }
  });

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

// List commands with offline support
const list = program.command('list').description('List items from Brain');

list.command('tasks')
  .description('List tasks')
  .option('-s, --status <status>', 'Filter by status (todo|in-progress|waiting|done)')
  .option('--overdue', 'Show only overdue tasks')
  .option('--offline', 'Use cached data')
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
      
      let response;
      let isOffline = false;
      
      if (options.offline) {
        const cache = loadCache();
        if (!cache) {
          spinner.fail(chalk.red('No cached data available. Run `brain sync` first.'));
          return;
        }
        response = { results: cache.databases.tasks || [] };
        isOffline = true;
        spinner.stop();
      } else {
        try {
          response = await notionRequest('POST', `/v1/databases/${DATABASES.tasks}/query`, {
            filter,
            sorts: [{ property: 'Due Date', direction: 'ascending' }]
          });
          spinner.stop();
        } catch (error) {
          // Fall back to cache
          const cache = loadCache();
          if (cache) {
            response = { results: cache.databases.tasks || [] };
            isOffline = true;
            spinner.warn(chalk.yellow('Using cached data (offline)'));
          } else {
            throw error;
          }
        }
      }
      
      if (response.results.length === 0) {
        console.log(chalk.dim('No tasks found'));
        return;
      }
      
      const table = new Table({
        head: [(isOffline ? '[OFFLINE] ID' : 'ID'), 'Task', 'Status', 'Due Date'].map(h => chalk.cyan.bold(h)),
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
      if (isOffline) {
        console.log(chalk.dim(`Cache age: ${getCacheAge()}`));
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to fetch tasks'));
      console.error(chalk.dim(error.message));
    }
  });

list.command('ideas')
  .description('List ideas')
  .option('-s, --status <status>', 'Filter by status (new|in-progress|parked|implemented)')
  .option('--offline', 'Use cached data')
  .action(async (options) => {
    const spinner = ora('Fetching ideas...').start();
    try {
      const filter = {};
      
      if (options.status) {
        const statusMap = { 'new': 'New', 'in-progress': 'In Progress', 'parked': 'Parked', 'implemented': 'Implemented' };
        filter.property = 'Status';
        filter.select = { equals: statusMap[options.status] || 'New' };
      }
      
      let response;
      let isOffline = false;
      
      if (options.offline) {
        const cache = loadCache();
        if (!cache) {
          spinner.fail(chalk.red('No cached data available. Run `brain sync` first.'));
          return;
        }
        response = { results: cache.databases.ideas || [] };
        isOffline = true;
        spinner.stop();
      } else {
        try {
          response = await notionRequest('POST', `/v1/databases/${DATABASES.ideas}/query`, {
            filter: Object.keys(filter).length > 0 ? filter : undefined,
            sorts: [{ timestamp: 'created_time', direction: 'descending' }]
          });
          spinner.stop();
        } catch (error) {
          const cache = loadCache();
          if (cache) {
            response = { results: cache.databases.ideas || [] };
            isOffline = true;
            spinner.warn(chalk.yellow('Using cached data (offline)'));
          } else {
            throw error;
          }
        }
      }
      
      if (response.results.length === 0) {
        console.log(chalk.dim('No ideas found'));
        return;
      }
      
      const table = new Table({
        head: [(isOffline ? '[OFFLINE] ID' : 'ID'), 'Idea', 'Status', 'Priority'].map(h => chalk.cyan.bold(h)),
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
      if (isOffline) {
        console.log(chalk.dim(`Cache age: ${getCacheAge()}`));
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to fetch ideas'));
      console.error(chalk.dim(error.message));
    }
  });

list.command('notes')
  .description('List recent notes')
  .option('-l, --limit <number>', 'Number of notes to show', '10')
  .option('--offline', 'Use cached data')
  .action(async (options) => {
    const spinner = ora('Fetching notes...').start();
    try {
      let response;
      let isOffline = false;
      
      if (options.offline) {
        const cache = loadCache();
        if (!cache) {
          spinner.fail(chalk.red('No cached data available. Run `brain sync` first.'));
          return;
        }
        response = { results: (cache.databases.notes || []).slice(0, parseInt(options.limit)) };
        isOffline = true;
        spinner.stop();
      } else {
        try {
          response = await notionRequest('POST', `/v1/databases/${DATABASES.notes}/query`, {
            sorts: [{ timestamp: 'created_time', direction: 'descending' }],
            page_size: parseInt(options.limit)
          });
          spinner.stop();
        } catch (error) {
          const cache = loadCache();
          if (cache) {
            response = { results: (cache.databases.notes || []).slice(0, parseInt(options.limit)) };
            isOffline = true;
            spinner.warn(chalk.yellow('Using cached data (offline)'));
          } else {
            throw error;
          }
        }
      }
      
      if (response.results.length === 0) {
        console.log(chalk.dim('No notes found'));
        return;
      }
      
      const table = new Table({
        head: [(isOffline ? '[OFFLINE] ID' : 'ID'), 'Topic', 'Summary'].map(h => chalk.cyan.bold(h)),
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
      if (isOffline) {
        console.log(chalk.dim(`Cache age: ${getCacheAge()}`));
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to fetch notes'));
      console.error(chalk.dim(error.message));
    }
  });

list.command('projects')
  .description('List projects')
  .option('-s, --status <status>', 'Filter by status (active|paused|archived)')
  .option('--offline', 'Use cached data')
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
      
      let response;
      let isOffline = false;
      
      if (options.offline) {
        const cache = loadCache();
        if (!cache) {
          spinner.fail(chalk.red('No cached data available. Run `brain sync` first.'));
          return;
        }
        response = { results: cache.databases.projects || [] };
        isOffline = true;
        spinner.stop();
      } else {
        try {
          response = await notionRequest('POST', `/v1/databases/${DATABASES.projects}/query`, {
            filter
          });
          spinner.stop();
        } catch (error) {
          const cache = loadCache();
          if (cache) {
            response = { results: cache.databases.projects || [] };
            isOffline = true;
            spinner.warn(chalk.yellow('Using cached data (offline)'));
          } else {
            throw error;
          }
        }
      }
      
      if (response.results.length === 0) {
        console.log(chalk.dim('No projects found'));
        return;
      }
      
      const table = new Table({
        head: [(isOffline ? '[OFFLINE] ID' : 'ID'), 'Project', 'Goal', 'Status'].map(h => chalk.cyan.bold(h)),
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
      if (isOffline) {
        console.log(chalk.dim(`Cache age: ${getCacheAge()}`));
      }
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
  .version('2.0.0');

program.parse();
