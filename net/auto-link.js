/** @type {NS} */
let ns;

/** @param {NS} _ns */
export async function main(_ns) {
  ns = _ns;
  ns.disableLog("scan");
  ns.disableLog("asleep");
  ns.clearLog();
  ns.tail();
  
  ns.printRaw(React.createElement(ServerNode, {hostname: "home"}));
  await ns.asleep(24*60*60*1000);
}

function getConnectCommand(path) {
  const commands = path.map((hostname)=>(
    hostname == 'home' ? 'home' : `connect ${hostname}`
  ));
  return commands.join('; ');
}

function getNeighborNodes(hostname, path) {
  const neighborNodes = ns.scan(hostname).filter((h)=>(
    !path.includes(h)
  )).map((h)=>(
    React.createElement(ServerNode, { key: h, hostname: h, path: [...path, hostname] })
  ));
  return neighborNodes;
};

function ServerNode({ hostname, path }) {
  path ??= [];
  const [neighbors, setNeighbors] = React.useState(null);
  if (neighbors === null) {
    setNeighbors(getNeighborNodes(hostname, path));
  }
  const connectCommand = getConnectCommand([...path, hostname]);
  const hostnameEl = React.createElement("a", {
    href: `javascript:navigator.clipboard.writeText("${connectCommand}");`, 
    onClick: ()=>{ ns.toast("Connection command copied to clipboard") }
  }, hostname);
  return React.createElement(
    "div",
    { key: hostname, style: { paddingLeft: "1em" } },
    [hostnameEl, neighbors]
  );
}
