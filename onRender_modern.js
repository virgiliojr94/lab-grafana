(() => {
  if (!htmlNode || !data || !data.series) return;

  const el = (q) => htmlNode.querySelector(q);
  const setText = (q, v) => { const n = el(q); if(n) n.innerHTML = v; };

  const last = (series) => {
    const n = series.fields.find(f => f.type === 'number');
    if (n && n.values.length) return n.values.get(n.values.length - 1);
    const s = series.fields.find(f => f.type === 'string');
    if (s && s.values.length) return s.values.get(s.values.length - 1);
    return null;
  };

  const findLastByName = (name) => {
    const s = data.series.find(x => x.name === name);
    return s ? last(s) : null;
  };

  const toNum = (v) => (isFinite(Number(v)) ? Number(v) : 0);

  const bps = (v) => {
    const x = Number(v ?? 0);
    if (!isFinite(x) || x < 0) return '0 b/s';
    const units = ['b/s','Kb/s','Mb/s','Gb/s','Tb/s'];
    let i=0, val=x;
    while (val >= 1024 && i < units.length-1){ val/=1024; i++; }
    return `${val.toFixed(val >= 100 ? 0 : val >= 10 ? 1 : 2)} ${units[i]}`;
  };

  const formatUptime = (bootTime) => {
    if (!bootTime) return '--';
    const now = Math.floor(Date.now() / 1000);
    const upSec = now - bootTime;
    const days = Math.floor(upSec / 86400);
    const hours = Math.floor((upSec % 86400) / 3600);
    const mins = Math.floor((upSec % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  const formatCertDays = (unixTime) => {
    if (!unixTime) return null;
    const now = Math.floor(Date.now() / 1000);
    const diff = unixTime - now;
    const days = Math.floor(diff / 86400);
    return days;
  };

  const updateClock = () => {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    setText('#clock', `${h}:${m}:${s}`);
  };
  updateClock();
  setInterval(updateClock, 1000);

  // Helper para criar gauge circular SVG
  const createGauge = (value, label, color, criticalThreshold = 90, warningThreshold = 80) => {
    const radius = 54;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (value / 100) * circumference;
    
    let strokeColor = color;
    if (value >= criticalThreshold) strokeColor = '#ef4444';
    else if (value >= warningThreshold) strokeColor = '#f59e0b';
    
    return `
      <div class="gauge-container">
        <div class="gauge">
          <svg viewBox="0 0 120 120">
            <circle class="gauge-bg" cx="60" cy="60" r="${radius}"/>
            <circle class="gauge-progress" cx="60" cy="60" r="${radius}" 
                    stroke="${strokeColor}"
                    stroke-dasharray="${circumference}"
                    stroke-dashoffset="${offset}"/>
          </svg>
          <div class="gauge-text">
            <span class="gauge-value" style="color:${strokeColor}">${value.toFixed(1)}</span>
            <span class="gauge-label">${label}</span>
          </div>
        </div>
      </div>
    `;
  };

  const rxRe = /^Incoming network traffic on (.+)$/i;
  const txRe = /^Outgoing network traffic on (.+)$/i;
  const rxErrRe = /^Incoming errors on (.+)$/i;
  const txErrRe = /^Outgoing errors on (.+)$/i;

  const byIf = new Map();
  const ensure = (ifn) => {
    if (!byIf.has(ifn)) byIf.set(ifn, { rx:0, tx:0, rxErr:0, txErr:0 });
    return byIf.get(ifn);
  };

  for (const s of data.series) {
    const name = s.name || '';
    let m;
    if ((m = name.match(rxRe))) ensure(m[1].trim()).rx = toNum(last(s));
    else if ((m = name.match(txRe))) ensure(m[1].trim()).tx = toNum(last(s));
    else if ((m = name.match(rxErrRe))) ensure(m[1].trim()).rxErr = toNum(last(s));
    else if ((m = name.match(txErrRe))) ensure(m[1].trim()).txErr = toNum(last(s));
  }

  const isWan = (n) => /^WAN($|[_-])/i.test(n);

  const items = [...byIf.entries()].map(([ifName, v]) => ({ ifName, ...v }));
  const wan = items.filter(x => isWan(x.ifName));
  const lan = items.filter(x => !isWan(x.ifName)).filter(x => !x.ifName.toLowerCase().startsWith('ovpns')).sort((a,b) => (b.rx+b.tx) - (a.rx+a.tx)).slice(0, 12);

  const errTotal = items.reduce((acc, x) => acc + x.rxErr + x.txErr, 0);

  // Coletar métricas do sistema
  const cpuIdle = toNum(findLastByName('CPU idle time'));
  const cpuUsage = 100 - cpuIdle;
  const memAvail = toNum(findLastByName('Available memory (percent)'));
  const memUsage = 100 - memAvail;
  const diskFree = toNum(findLastByName('Free disk space on / (percentage)'));
  const diskUsage = 100 - diskFree;
  const swapFree = toNum(findLastByName('Free swap space in %'));
  const swapUsage = 100 - swapFree;
  const procTotal = toNum(findLastByName('Number of processes'));
  const procRun = toNum(findLastByName('Number of running processes'));
  const bootTime = toNum(findLastByName('Host boot time'));
  const uptime = formatUptime(bootTime);
  const mbufUsage = toNum(findLastByName('MBUF Total Used (percent)'));
  const newVersion = findLastByName('New Version of pfSense Available');
  const certExpiry = toNum(findLastByName('Certificates Manager: earliest validTo'));
  const certDays = formatCertDays(certExpiry);
  const statesUsagePercentRaw = findLastByName('States Table Current (percent)');
  const statesCurrent = toNum(findLastByName('States Table Current'));
  const statesMax = toNum(findLastByName('States Table Max'));
  let statesUsagePercent = toNum(statesUsagePercentRaw);
  if (statesUsagePercent <= 0 && statesCurrent > 0 && statesMax > 0) {
    statesUsagePercent = (statesCurrent / statesMax) * 100;
  }
  const dhcpProblems = toNum(findLastByName('DHCP Failover Pool Problems'));
  const carpStatus = findLastByName('CARP Status');
  const carpExpected = findLastByName('Expected CARP Status');
  const ipsecStatus = findLastByName('IPsec Tunnel 1 VPN CIELO  Phase 1 Status');
  const ipsecEnabled = findLastByName('IPsec Tunnel 1 VPN CIELO Tunnel Enabled');

  // Gateway processing
  const gwNames = ['WAN', 'GW_WAN_CTI', 'defualtvl', 'extranet_ctiGW2', 'extranet_sfzGW', 'GW_DMZ', 'intranet', 'srvsintranet'];
  const gw = gwNames.map(name => ({
    name,
    status: findLastByName(`Gateway ${name} Status`),
    loss: findLastByName(`Gateway ${name} Packet  Loss`),
    rtt: findLastByName(`Gateway ${name} RTT`),
    stddev: findLastByName(`Gateway ${name} RTT Std Deviation`)
  })).filter(g => g.status != null);

  const gwOnline = gw.filter(g => {
    const s = String(g.status ?? '').trim().toLowerCase();
    return s.includes('up') || s.includes('online') || s.includes('ok') || s === '0' || s === '0.0';
  }).length;
  const gwTotal = gw.length;

  const gwStats = gw.reduce((acc, g) => {
    const s = (g.status ?? '').toString();
    const isUp = (() => {
      const clean = s.trim().toLowerCase();
      return clean.includes('up') || clean.includes('online') || clean.includes('ok') || clean === '0' || clean === '0.0';
    })();
    const lossNum = toNum((g.loss ?? '').toString().replace('%',''));
    const rttNum = toNum((g.rtt ?? '').toString().replace('ms',''));
    const stddevNum = toNum((g.stddev ?? '').toString().replace('ms',''));
    
    if (!isUp) acc.down++;
    else if (rttNum > 500) acc.down++;
    else if (lossNum >= 2 || stddevNum > 10 || rttNum > 200) acc.warn++;
    return acc;
  }, { down: 0, warn: 0 });

  // Determinar status global
  const criticalSignals = [
    gwStats.down > 0,
    statesUsagePercent > 85,
    swapUsage > 10,
    mbufUsage > 90,
    cpuUsage > 90,
    memUsage > 90,
    diskUsage > 90,
    carpStatus && carpExpected && carpStatus !== carpExpected
  ];

  const warningSignals = [
    gwStats.warn > 0,
    statesUsagePercent > 70,
    swapUsage > 5,
    mbufUsage > 80,
    cpuUsage > 80,
    memUsage > 80,
    diskUsage > 80,
    dhcpProblems > 0,
    errTotal > 100
  ];

  let globalClass = 'ok', globalLabel = 'All Systems Operational', globalIcon = '✓', globalColor = '#10b981';
  if (criticalSignals.some(Boolean)) {
    globalClass = 'critical';
    globalLabel = 'Critical Issues Detected';
    globalIcon = '⚠';
    globalColor = '#ef4444';
  } else if (warningSignals.some(Boolean)) {
    globalClass = 'degraded';
    globalLabel = 'System Performance Degraded';
    globalIcon = '⚡';
    globalColor = '#f59e0b';
  }

  // Renderizar status global
  const globalStatusHTML = `
    <div class="global-status ${globalClass}">
      <div class="global-status-icon">${globalIcon}</div>
      <div class="global-status-value" style="color:${globalColor}">${globalLabel}</div>
      <div class="global-status-label">Firewall Health Status</div>
    </div>
  `;
  setText('#global-status', globalStatusHTML);

  // Renderizar gauges do sistema
  const gaugesHTML = `
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px">
      ${createGauge(cpuUsage, 'CPU', '#3b82f6')}
      ${createGauge(memUsage, 'Memory', '#10b981')}
      ${createGauge(diskUsage, 'Disk', '#f59e0b')}
      ${createGauge(statesUsagePercent, 'States', '#8b5cf6', 85, 70)}
    </div>
  `;
  setText('#system-gauges', gaugesHTML);

  // Renderizar resumo rápido
  const summaryHTML = `
    <div class="summary-item">
      <span class="summary-label">Uptime</span>
      <span class="summary-value">${uptime}</span>
    </div>
    <div class="summary-item">
      <span class="summary-label">WAN Interfaces</span>
      <span class="summary-value">${wan.length}</span>
    </div>
    <div class="summary-item">
      <span class="summary-label">Gateways Online</span>
      <span class="summary-value ${gwOnline < gwTotal ? 'warning' : 'good'}">${gwOnline} / ${gwTotal}</span>
    </div>
    <div class="summary-item">
      <span class="summary-label">Network Errors</span>
      <span class="summary-value ${errTotal > 100 ? 'critical' : errTotal > 0 ? 'warning' : 'good'}">${errTotal}</span>
    </div>
    <div class="summary-item">
      <span class="summary-label">Processes</span>
      <span class="summary-value">${procRun} / ${procTotal}</span>
    </div>
    <div class="summary-item">
      <span class="summary-label">MBUF Usage</span>
      <span class="summary-value ${mbufUsage > 90 ? 'critical' : mbufUsage > 80 ? 'warning' : 'good'}">${mbufUsage.toFixed(1)}%</span>
    </div>
    <div class="summary-item">
      <span class="summary-label">Swap Usage</span>
      <span class="summary-value ${swapUsage > 10 ? 'critical' : swapUsage > 5 ? 'warning' : 'good'}">${swapUsage.toFixed(1)}%</span>
    </div>
  `;
  setText('#summary', summaryHTML);

  // Criar card de interface moderna
  const mkIfCard = (x) => {
    const total = x.rx + x.tx;
    const hasTraffic = total > 0;
    const hasErr = (x.rxErr + x.txErr) > 0;
    const adminStatus = findLastByName(`Interface ${x.ifName} Admin Status`);
    const adminDown = adminStatus && (String(adminStatus).toLowerCase().includes('down') || String(adminStatus) === '0');
    const linkStatus = findLastByName(`Interface ${x.ifName} Link Status`);
    const linkDown = linkStatus && (String(linkStatus).toLowerCase().includes('down') || String(linkStatus) === '0');
    
    let status = 'up', label = 'Online', cardClass = 'success';
    if (adminDown) {
      status = 'down';
      label = 'Admin Down';
      cardClass = 'critical';
    } else if (linkDown) {
      status = 'down';
      label = 'No Link';
      cardClass = 'critical';
    } else if (hasErr) {
      status = 'warn';
      label = 'Errors';
      cardClass = 'warning';
    } else if (!hasTraffic) {
      status = 'up';
      label = 'Idle';
      cardClass = 'info';
    }

    return `
      <div class="status-card ${cardClass}">
        <div class="status-header">
          <div class="status-title">${x.ifName}</div>
          <div class="status-badge ${status}">${label}</div>
        </div>
        <div class="traffic-indicator">
          <span class="traffic-icon">⬇</span>
          <span class="traffic-label">Inbound</span>
          <span class="traffic-value">${bps(x.rx)}</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill network" style="width:${total > 0 ? Math.min((x.rx / total) * 100, 100) : 0}%"></div>
        </div>
        <div class="traffic-indicator">
          <span class="traffic-icon">⬆</span>
          <span class="traffic-label">Outbound</span>
          <span class="traffic-value">${bps(x.tx)}</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill network" style="width:${total > 0 ? Math.min((x.tx / total) * 100, 100) : 0}%"></div>
        </div>
        ${hasErr ? `<div class="metric-item" style="margin-top:12px;border:1px solid #ef4444">
          <div class="metric-label">Errors (In/Out)</div>
          <div class="metric-value" style="color:#ef4444">${x.rxErr} / ${x.txErr}</div>
        </div>` : ''}
      </div>
    `;
  };

  setText('#wan-interfaces', wan.length > 0 ? wan.map(mkIfCard).join('') : '<div style="text-align:center;color:#64748b;padding:40px">No WAN interfaces detected</div>');
  setText('#lan-interfaces', lan.length > 0 ? lan.map(mkIfCard).join('') : '<div style="text-align:center;color:#64748b;padding:40px">No LAN interfaces detected</div>');

  // Criar card de gateway moderna
  const mkGwCard = (g) => {
    const s = (g.status ?? '').toString();
    const isUp = (() => {
      const clean = s.trim().toLowerCase();
      return clean.includes('up') || clean.includes('online') || clean.includes('ok') || clean === '0' || clean === '0.0';
    })();
    const lossNum = toNum((g.loss ?? '').toString().replace('%',''));
    const rttNum = toNum((g.rtt ?? '').toString().replace('ms',''));
    const stddevNum = toNum((g.stddev ?? '').toString().replace('ms',''));
    
    let badge = 'up', label = 'Online', cardClass = 'success';
    if (!isUp) {
      badge='down';
      label='Offline';
      cardClass='critical';
    } else if (rttNum > 500) {
      badge='down';
      label='Critical Latency';
      cardClass='critical';
    } else if (lossNum >= 2 || stddevNum > 10 || rttNum > 200) {
      badge='warn';
      label='Degraded';
      cardClass='warning';
    }

    const lossTxt = g.loss == null ? '--' : (typeof g.loss === 'number' ? `${g.loss.toFixed(1)}%` : String(g.loss));
    const rttTxt = g.rtt == null ? '--' : (typeof g.rtt === 'number' ? `${g.rtt.toFixed(1)} ms` : String(g.rtt));
    const stddevTxt = g.stddev == null ? '--' : (typeof g.stddev === 'number' ? `${g.stddev.toFixed(1)} ms` : String(g.stddev));

    return `
      <div class="status-card ${cardClass}">
        <div class="status-header">
          <div class="status-title">GW ${g.name}</div>
          <div class="status-badge ${badge}">${label}</div>
        </div>
        <div class="metric-grid">
          <div class="metric-item">
            <div class="metric-label">Packet Loss</div>
            <div class="metric-value" style="color:${lossNum > 2 ? '#ef4444' : '#10b981'}">${lossTxt}</div>
          </div>
          <div class="metric-item">
            <div class="metric-label">RTT</div>
            <div class="metric-value" style="color:${rttNum > 500 ? '#ef4444' : rttNum > 200 ? '#f59e0b' : '#10b981'}">${rttTxt}</div>
          </div>
          <div class="metric-item" style="grid-column:1/-1">
            <div class="metric-label">Jitter (StdDev)</div>
            <div class="metric-value" style="color:${stddevNum > 10 ? '#f59e0b' : '#94a3b8'}">${stddevTxt}</div>
          </div>
        </div>
      </div>
    `;
  };

  setText('#gateways', gw.length > 0 ? gw.map(mkGwCard).join('') : '<div style="text-align:center;color:#64748b;padding:40px">No gateways configured</div>');

  // OpenVPN processing
  const ovpnRe = /^OpenVPN Server (.+) Clients Connected$/i;
  const ovpnServers = [];
  const ovpnStatusInfo = (v) => {
    const s = String(v ?? '').trim().toLowerCase();
    if (!s) return { level: 'down', isUp: false, label: 'Unknown' };
    if (s.includes('up') || s.includes('connected') || s.includes('ok') || s.includes('listening')) return { level: 'up', isUp: true, label: 'Up' };
    if (s.includes('reconnecting')) return { level: 'warn', isUp: false, label: 'Reconnecting' };
    if (s.includes('waiting')) return { level: 'warn', isUp: false, label: 'Waiting' };
    if (s.includes('down') || s.includes('disconnected') || s.includes('fail')) return { level: 'down', isUp: false, label: 'Down' };
    const n = Number(s);
    if (isFinite(n)) {
      if (n === 0) return { level: 'down', isUp: false, label: 'Down' };
      if (n === 1) return { level: 'up', isUp: true, label: 'Up' };
      if (n === 2) return { level: 'warn', isUp: false, label: 'None' };
      if (n === 3) return { level: 'warn', isUp: false, label: 'Reconnecting' };
      if (n === 4) return { level: 'warn', isUp: false, label: 'Waiting' };
      if (n === 5) return { level: 'up', isUp: true, label: 'Listening' };
      return { level: n > 0 ? 'up' : 'down', isUp: n > 0, label: n > 0 ? 'Up' : 'Down' };
    }
    return { level: 'down', isUp: false, label: 'Unknown' };
  };

  for (const s of data.series) {
    const name = s.name || '';
    const m = name.match(ovpnRe);
    if (!m) continue;
    const serverName = m[1].trim();
    const clients = toNum(last(s));
    const statusSeries = data.series.find(x => x.name === `OpenVPN Server ${serverName} Tunnel Status`);
    const tunnelStatus = statusSeries ? last(statusSeries) : null;
    ovpnServers.push({ serverName, clients, tunnelStatus });
  }
  ovpnServers.sort((a,b) => b.clients - a.clients);

  const mkOvpnCard = (o) => {
    const info = ovpnStatusInfo(o.tunnelStatus);
    let badge='down', label='Down', cardClass='critical';
    
    if (info.level === 'warn') {
      badge='warn';
      label=info.label;
      cardClass='warning';
    } else if (info.isUp) {
      if (o.clients > 0) {
        badge='up';
        label='Active';
        cardClass='success';
      } else {
        badge='warn';
        label='Idle';
        cardClass='info';
      }
    }

    return `
      <div class="status-card ${cardClass}">
        <div class="status-header">
          <div class="status-title">${o.serverName}</div>
          <div class="status-badge ${badge}">${label}</div>
        </div>
        <div style="text-align:center;padding:20px 0">
          <div style="font-size:48px;font-weight:700;color:#3b82f6;line-height:1">${o.clients}</div>
          <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-top:8px">Connected Clients</div>
        </div>
        <div class="metric-item">
          <div class="metric-label">Tunnel Status</div>
          <div class="metric-value" style="font-size:11px">${info.label}</div>
        </div>
      </div>
    `;
  };

  setText('#ovpn-servers', ovpnServers.length > 0 ? ovpnServers.map(mkOvpnCard).join('') : '<div style="text-align:center;color:#64748b;padding:40px">No OpenVPN servers configured</div>');

  // Gerar alertas
  const alerts = [];
  
  if (swapUsage > 10) {
    alerts.push({ severity: 'critical', icon: '🔴', msg: `Swap usage critical: ${swapUsage.toFixed(1)}% - Severe memory pressure detected!` });
  } else if (swapUsage > 5) {
    alerts.push({ severity: 'warning', icon: '⚠', msg: `Swap usage detected: ${swapUsage.toFixed(1)}% - Memory pressure warning` });
  }
  
  if (statesUsagePercent > 85) {
    alerts.push({ severity: 'critical', icon: '🔴', msg: `States table critical: ${statesUsagePercent.toFixed(1)}% - Risk of connection drops!` });
  } else if (statesUsagePercent > 70) {
    alerts.push({ severity: 'warning', icon: '⚠', msg: `States table high: ${statesUsagePercent.toFixed(1)}% - Monitor closely` });
  }
  
  if (mbufUsage > 90) {
    alerts.push({ severity: 'critical', icon: '🔴', msg: `MBUF usage critical: ${mbufUsage.toFixed(1)}%` });
  } else if (mbufUsage > 80) {
    alerts.push({ severity: 'warning', icon: '⚠', msg: `MBUF usage high: ${mbufUsage.toFixed(1)}%` });
  }
  
  if (cpuUsage > 90) {
    alerts.push({ severity: 'critical', icon: '🔴', msg: `CPU usage critical: ${cpuUsage.toFixed(1)}%` });
  } else if (cpuUsage > 80) {
    alerts.push({ severity: 'warning', icon: '⚠', msg: `CPU usage high: ${cpuUsage.toFixed(1)}%` });
  }
  
  if (memUsage > 90) {
    alerts.push({ severity: 'critical', icon: '🔴', msg: `Memory usage critical: ${memUsage.toFixed(1)}%` });
  } else if (memUsage > 80) {
    alerts.push({ severity: 'warning', icon: '⚠', msg: `Memory usage high: ${memUsage.toFixed(1)}%` });
  }
  
  if (diskUsage > 90) {
    alerts.push({ severity: 'critical', icon: '🔴', msg: `Disk usage critical: ${diskUsage.toFixed(1)}%` });
  } else if (diskUsage > 80) {
    alerts.push({ severity: 'warning', icon: '⚠', msg: `Disk usage high: ${diskUsage.toFixed(1)}%` });
  }
  
  if (gwStats.down > 0) {
    alerts.push({ severity: 'critical', icon: '🔴', msg: `${gwStats.down} gateway(s) offline or critical latency` });
  } else if (gwStats.warn > 0) {
    alerts.push({ severity: 'warning', icon: '⚠', msg: `${gwStats.warn} gateway(s) degraded performance` });
  }
  
  if (errTotal > 100) {
    alerts.push({ severity: 'warning', icon: '⚠', msg: `High interface errors: ${errTotal} total errors detected` });
  }
  
  if (dhcpProblems > 0) {
    alerts.push({ severity: 'warning', icon: '⚠', msg: `DHCP failover issues detected: ${dhcpProblems}` });
  }
  
  if (carpStatus && carpExpected && carpStatus !== carpExpected) {
    alerts.push({ severity: 'critical', icon: '🔴', msg: `CARP status mismatch: ${carpStatus} (expected: ${carpExpected})` });
  }
  
  if (ipsecStatus && ipsecEnabled !== '1') {
    const st = String(ipsecStatus).toLowerCase();
    if (!st.includes('up') && !st.includes('connected')) {
      alerts.push({ severity: 'warning', icon: '⚠', msg: `IPsec VPN CIELO: ${ipsecStatus}` });
    }
  }
  
  if (newVersion && String(newVersion).toLowerCase() !== 'no') {
    alerts.push({ severity: 'info', icon: 'ℹ', msg: `pfSense update available: ${newVersion}` });
  }
  
  if (certDays !== null) {
    if (certDays < 7) {
      alerts.push({ severity: 'critical', icon: '🔴', msg: `Certificate expires in ${certDays} days!` });
    } else if (certDays < 30) {
      alerts.push({ severity: 'warning', icon: '⚠', msg: `Certificate expires in ${certDays} days` });
    }
  }

  const alertsHTML = alerts.length === 0 
    ? `<div class="alert-item info" style="border-color:#10b981">
         <div class="alert-icon">✓</div>
         <div class="alert-content">
           <div class="alert-severity" style="color:#10b981">All Clear</div>
           <div class="alert-message">No alerts or warnings detected. All systems operating normally.</div>
         </div>
       </div>`
    : alerts.map(a => `
        <div class="alert-item ${a.severity}">
          <div class="alert-icon">${a.icon}</div>
          <div class="alert-content">
            <div class="alert-severity">${a.severity}</div>
            <div class="alert-message">${a.msg}</div>
          </div>
        </div>
      `).join('');
  
  setText('#alerts', alertsHTML);
})();
