let currentContainerId = null;
const socket = io();

// Update Terminal configuration
const term = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    theme: {
        background: '#000000',
        foreground: '#ffffff'
    },
    convertEol: true,
    cursorStyle: 'block',
    scrollback: 1000,
    cols: 80,
    rows: 24
});

// Initialize terminal
term.open(document.getElementById('terminal'));

// DOM elements
const createButton = document.getElementById('createContainer');
const containerStatus = document.getElementById('containerStatus');
const containerList = document.getElementById('container-list');

// Function to fetch and display all containers
async function updateContainerList() {
    try {
        const response = await fetch('/api/containers');
        const data = await response.json();
        
        if (data.success) {
            containerList.innerHTML = '<h3>Available Containers</h3>';
            data.containers.forEach(container => {
                const containerElement = document.createElement('div');
                containerElement.className = `container-item ${container.Id === currentContainerId ? 'active' : ''}`;
                containerElement.innerHTML = `
                    <div class="container-info">
                        <div>ID: ${container.Id.substring(0, 12)}</div>
                        <div>Name: ${container.Names[0]}</div>
                        <div>Status: ${container.State}</div>
                    </div>
                    <div class="container-actions">
                        <button class="connect-btn" onclick="connectToContainer('${container.Id}')">Connect</button>
                        <button class="delete-btn" onclick="deleteContainer('${container.Id}')">Delete</button>
                    </div>
                `;
                containerList.appendChild(containerElement);
            });
        }
    } catch (error) {
        console.error('Error fetching containers:', error);
    }
}

// Create container
createButton.addEventListener('click', async () => {
    try {
        const response = await fetch('/api/containers/create', {
            method: 'POST'
        });
        const data = await response.json();
        
        if (data.success) {
            await updateContainerList();
            containerStatus.textContent = `Container created: ${data.containerId.substring(0, 12)}`;
        }
    } catch (error) {
        console.error('Error creating container:', error);
        containerStatus.textContent = 'Error creating container';
    }
});

// Connect to container
async function connectToContainer(containerId) {
    try {
        // Clear any existing socket listeners first
        socket.removeAllListeners('terminal_output');
        socket.removeAllListeners('error');
        
        currentContainerId = containerId;
        term.clear();
        
        // Show connecting message
        term.write('Connecting to container...\r\n');
        
        // Set up new listeners
        socket.on('terminal_output', (data) => {
            term.write(data);
        });
        
        socket.on('error', (error) => {
            console.error('Socket error:', error);
            term.writeln(`\r\nError: ${error}`);
        });
        
        // Connect to container
        socket.emit('attach_container', containerId);
        
        // Update UI
        updateContainerList();
        containerStatus.textContent = `Connected to container: ${containerId.substring(0, 12)}`;
        
        // Focus terminal
        term.focus();
    } catch (error) {
        console.error('Error connecting to container:', error);
        term.writeln(`\r\nError connecting to container: ${error.message}`);
    }
}

// Delete container
async function deleteContainer(containerId) {
    try {
        const response = await fetch(`/api/containers/${containerId}`, {
            method: 'DELETE'
        });
        const data = await response.json();
        
        if (data.success) {
            if (containerId === currentContainerId) {
                currentContainerId = null;
                term.clear();
            }
            await updateContainerList();
            containerStatus.textContent = 'Container deleted';
        }
    } catch (error) {
        console.error('Error deleting container:', error);
        containerStatus.textContent = 'Error deleting container';
    }
}

// Update Terminal input handling
term.onData(data => {
    if (currentContainerId) {
        socket.emit('terminal_input', data);
    }
});

// Add a clear terminal function
function clearTerminal() {
    term.clear();
    term.write('\x1b[H\x1b[2J');
}

// Add resize handling
term.onResize(({ cols, rows }) => {
    if (currentContainerId) {
        socket.emit('resize', { cols, rows });
    }
});

// Initial container list load
updateContainerList();

// Refresh container list periodically
setInterval(updateContainerList, 5000);
 