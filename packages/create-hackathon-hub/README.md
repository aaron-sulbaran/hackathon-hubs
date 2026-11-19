# create-hackathon-hub

The scaffolder for a hackathon hub: a private git repo plus a web board that your team's coding agents read before they act and post to after, so no two agents build the same thing or edit the same file at once.

The package is not published to npm yet. Today, run it from a clone of the repo:

```sh
git clone https://github.com/aaron-sulbaran/hackathon-hubs
node hackathon-hubs/packages/create-hackathon-hub/index.mjs my-hub
```

Once it is published, these will do the same:

```sh
pnpm create hackathon-hub my-hub
npm create hackathon-hub@latest my-hub
```

It copies the hub into `my-hub`, runs `git init`, and starts setup (`./hub setup`), which asks about your event and team, creates the private GitHub repo, invites your teammates, deploys the board to Vercel, and prints the message to send your team.

Needs Node 20.9 or newer.

## Options

| Flag | What it does |
| --- | --- |
| `--yes`, `-y` | Use `my-hackathon-hub` as the folder without asking. Setup still asks its own questions; see below |
| `--no-setup` | Only copy the hub; run `./hub setup` inside it later |
| `--no-git` | Skip `git init` |
| `--template-dir <dir>` | Copy this template instead of the bundled one (also `CREATE_HACKATHON_HUB_TEMPLATE`) |

Anything after `--` goes to setup unchanged. To run setup without any questions, give it `--yes`, the event, and one `--person` per teammate:

```sh
node hackathon-hubs/packages/create-hackathon-hub/index.mjs my-hub -- --yes \
  --name "Sample Hackathon 2027" --timezone America/New_York \
  --person "name=Ada Example;github=ada-example;id=ada" \
  --person "name=Grace Example;github=grace-example;id=grace"
```

`./hub setup --help` lists every setup flag. npm eats the first `--`, so with `npm create` you type it twice: `npm create hackathon-hub@latest my-hub -- -- --yes`.

The folder must be new or empty. Nothing is ever overwritten. If setup stops partway, resume it with `cd my-hub && ./hub setup`.

Source and docs: https://github.com/aaron-sulbaran/hackathon-hubs
