# Glossary

- **Server**: the one process you start. It keeps every thread and every agent's conversation in one SQLite file.
- **Runner**: connects a machine to the server, offering its folders and the model logins pi has there. File tools reach nothing outside those folders; shell commands aren't confined. The server holds no logins.
- **Agent**: a model, how hard it thinks, and the runner it works on, written `sonnet:high@laptop`. Every part is optional; `laptop` alone is that runner's default model. Each thread has one. Change its model or runner whenever you like and it keeps the conversation. It has no name.
- **Thread**: what people, one agent and any bots write to each other. _Hands off_ prevents its agents from editing files or running commands.
- **Bot**: one name in many threads, with a home thread, the agent it joins as, and instructions. Only bots have names.
- **Conversation**: what one agent has read, its tool calls and its answers.
- **Client**: the web page, the CLI or a Matrix room you use to read and write in threads; the server keeps the data.
