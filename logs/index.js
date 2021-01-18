const { appendFileSync,  } = require('fs');
const tail = require('tail');
const globby = require("globby");
const chokidar = require("chokidar");

const FILTERS = process.env.FILTERS;

//
// The log file that the outside world will access
//
const OUTPUT_LOGS_FILE = `/logs/${process.env.FILENAME}`;

//
// The directory on the node containing log files.
//
const LOG_FILES_DIRECTORY = "/var/log/containers";

//
// A glob that identifies the log files we'd like to track.
//
const LOG_FILES_GLOB = [
        // Track all log files in the log files diretory.
    `${LOG_FILES_DIRECTORY}/*.log`,                 

        // Except... don't track logs for Kubernetes system pods.
    `!${LOG_FILES_DIRECTORY}/*kube-system*.log`,    
];

const IGNORE_FILTERS = [
    'kubernetes-dashboard',
    'kube-apiserver-docker-desktop',
    'dashboard-metrics-scraper',
    'kube-scheduler-docker-desktop',
    'vpnkit-controller',
    'etcd-docker-desktop',
    'coredns'
]

//
// List of filters provided from Helm values.yaml to only
// grab log lines from resources that contains 1 of these filters 
//
const EXCLUSIVE_FILTERS = FILTERS && FILTERS.split(' ');

//
// Map of log files currently being tracked.
//
const trackedFiles = {};

//
// This function is called when a line of output is received 
// from any container on the node.
//
function onLogLine(containerName, line) {
    // The line is a JSON object so parse it first to extract relevant data.
    let data;
    try {
        data = JSON.parse(line);
    } catch (err) {
        console.error(err);
        return;
    }
    const isError = data.stream === "stderr"; // Is the output an error?
    const level = isError ? "error" : "info";
    // const timestamp = moment().valueOf();

    const log = `[${containerName}]/[${level}] : ${data.log}`;
    console.log(log);
    // appendFileSync(OUTPUT_LOGS_FILE, log);
}

//
// Commence tracking a particular log file.
//
function trackFile(logFilePath) {
    const _tail = new tail.Tail(logFilePath);

    // Take note that we are now tracking this file.
    trackedFiles[logFilePath] = _tail; 

    // Super simple way to extract the container name from the log filename.
    const [containerPath, __namespace, __logName] = logFilePath.split('_');
    const containerPathSegments = containerPath.split('/');
    const containerName = containerPathSegments[containerPathSegments.length - 1];

    for (let filter of IGNORE_FILTERS) {
        if (containerName.includes(filter))
            return;
    }

    if (EXCLUSIVE_FILTERS)
    {
        for (let filter in EXCLUSIVE_FILTERS)
            if (!containerName.includes(filter))
                return;
    }
    
    console.log(`tracking new log file for container ${containerName} at path ${logFilePath}`);

    // Handle new lines of output in the log file.
    _tail.on("line", line => onLogLine(containerName, line));

    // Handle any errors that might occur.
    _tail.on("error", error => console.error(`ERROR: ${error}`));
}

//
// Identify log files to be tracked and start tracking them.
//
async function trackFiles() {
    const logFilePaths = await globby(LOG_FILES_GLOB);
    for (const logFilePath of logFilePaths) {
        // Start tracking this log file we just identified.
        trackFile(logFilePath); 
    }
}

async function main() {
    // Start tracking initial log files.
    await trackFiles();

    // Track new log files as they are created.
    chokidar.watch(LOG_FILES_GLOB) 
        .on("add", newLogFilePath => trackFile(newLogFilePath)); 
}

main() 
    .then(() => console.log("Online"))
    .catch(err => {
        console.error("Failed to start!");
        console.error(err && err.stack || err);
    });