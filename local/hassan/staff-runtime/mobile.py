"""Private LAN TLS preparation/rebinding. Stops ONLY the verified test backend."""
import argparse
import ipaddress
import json
import os
import plistlib
import re
import signal
import ssl
import subprocess
import time
import urllib.request
import uuid
from datetime import datetime,timedelta,timezone
import runtime
from control import verified_pid


def prepare():
    cfg=runtime.load()
    interface=subprocess.check_output(['/sbin/ifconfig','en0'],text=True)
    match=re.search(r'\binet (\d+\.\d+\.\d+\.\d+) netmask (0x[0-9a-f]+)',interface)
    if not match:raise RuntimeError('No IPv4 Wi-Fi address; no network exposure enabled')
    address=ipaddress.ip_address(match[1]);mask=str(ipaddress.ip_address(int(match[2],16)))
    if not address.is_private or address.is_loopback or address.is_link_local:raise RuntimeError('Private Wi-Fi required')
    hostname=subprocess.check_output(['/bin/hostname'],text=True).strip().lower()
    if not re.fullmatch(r'[a-z0-9-]+\.local',hostname):raise RuntimeError('Expected a local Bonjour hostname')
    server=json.loads((runtime.PRIVATE/'server.json').read_text());pid=server['pid']
    verified_pid(pid,str(runtime.WORKSPACE/'local/omar/staff-runtime/runtime.py')+' serve',runtime.WORKSPACE)
    owners=subprocess.check_output(['/usr/sbin/lsof','-nP','-iTCP:54443','-sTCP:LISTEN','-t'],text=True).split()
    if set(owners)!={str(pid)}:raise RuntimeError('Test backend exclusive ownership mismatch')
    existing=subprocess.run(['/usr/sbin/lsof','-nP','-iTCP:54444','-sTCP:LISTEN','-t'],capture_output=True,text=True)
    if existing.returncode not in (0,1) or existing.stderr or (existing.stdout and set(existing.stdout.split())!={str(pid)}):raise RuntimeError('Mobile port belongs to another process')
    from cryptography import x509
    from cryptography.x509.oid import NameOID,ExtendedKeyUsageOID
    from cryptography.hazmat.primitives import hashes,serialization
    from cryptography.hazmat.primitives.asymmetric import ec
    ca=x509.load_pem_x509_certificate((runtime.PRIVATE/'ca.pem').read_bytes())
    if ca.fingerprint(hashes.SHA256()).hex()!=cfg['ca_sha256']:raise RuntimeError('CA fingerprint changed')
    ca_key=serialization.load_pem_private_key((runtime.PRIVATE/'ca-key.pem').read_bytes(),password=None)
    key=ec.generate_private_key(ec.SECP256R1());now=datetime.now(timezone.utc)
    if ca.not_valid_after_utc<=now+timedelta(days=1):raise RuntimeError('Test CA expired/near expiry; owner trust review required')
    leaf=(x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,hostname)]))
        .issuer_name(ca.subject).public_key(key.public_key()).serial_number(x509.random_serial_number())
        .not_valid_before(now-timedelta(minutes=5)).not_valid_after(min(now+timedelta(days=7),ca.not_valid_after_utc))
        .add_extension(x509.BasicConstraints(ca=False,path_length=None),critical=True)
        .add_extension(x509.SubjectAlternativeName([x509.DNSName(hostname),x509.DNSName('localhost'),x509.IPAddress(address),x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]),critical=False)
        .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),critical=False).sign(ca_key,hashes.SHA256()))
    os.umask(0o077)
    (runtime.PRIVATE/'mobile-server.pem').write_bytes(leaf.public_bytes(serialization.Encoding.PEM))
    (runtime.PRIVATE/'mobile-server-key.pem').write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
    der=ca.public_bytes(serialization.Encoding.DER);(runtime.PRIVATE/'iphone-ca.cer').write_bytes(der)
    profile=dict(PayloadContent=[dict(PayloadCertificateFileName='iphone-ca.cer',PayloadContent=der,PayloadDescription='Temporary isolated Staff test CA',PayloadDisplayName='Omar disposable Staff QA CA',PayloadIdentifier='com.omar.staffqa.root.'+cfg['integration_id'],PayloadType='com.apple.security.root',PayloadUUID=str(uuid.uuid4()).upper(),PayloadVersion=1)],
        PayloadDisplayName='Omar Staff QA — TEST ONLY',PayloadDescription='Temporary root certificate for isolated local Staff field testing. Remove after testing.',PayloadIdentifier='com.omar.staffqa.profile.'+cfg['integration_id'],PayloadRemovalDisallowed=False,PayloadType='Configuration',PayloadUUID=str(uuid.uuid4()).upper(),PayloadVersion=1)
    (runtime.PRIVATE/'iphone-test-ca.mobileconfig').write_bytes(plistlib.dumps(profile))
    cfg['mobile']=dict(hostname=hostname,bind_ip=str(address),subnet=str(ipaddress.ip_network(str(address)+'/'+mask,strict=False)),port=54444,origin='https://'+hostname+':54444')
    runtime.validate(cfg);runtime.write_json(runtime.PRIVATE/'config.json',cfg)
    # Only test server restart: no PostgreSQL or operational service signal.
    os.kill(pid,signal.SIGINT)
    for _ in range(100):
        occupied=subprocess.run(['/usr/sbin/lsof','-nP','-iTCP:54443','-sTCP:LISTEN','-t'],capture_output=True,text=True)
        if occupied.returncode==1 and not occupied.stdout and not occupied.stderr:break
        time.sleep(.1)
    else:raise RuntimeError('Test listener did not release; no other process will be stopped')
    log=(runtime.PRIVATE/'backend.log').open('ab')
    child=subprocess.Popen([str(runtime.WORKSPACE/'.local/omar/venv/bin/python'),str(runtime.WORKSPACE/'local/omar/staff-runtime/runtime.py'),'serve'],cwd=runtime.WORKSPACE,env={**runtime.clean_env(),'PYTHONUNBUFFERED':'1'},stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,start_new_session=True);log.close()
    context=ssl.create_default_context(cafile=str(runtime.PRIVATE/'ca.pem'))
    client=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPSHandler(context=context))
    for _ in range(100):
        if child.poll() is not None:raise RuntimeError('Test backend failed; inspect private log')
        try:
            with client.open(runtime.ORIGIN+'/health',timeout=1) as r:health=json.load(r)
            if health.get('integration_id')!=cfg['integration_id']:raise RuntimeError('Wrong test environment')
            break
        except OSError:time.sleep(.1)
    else:raise RuntimeError('Test backend readiness timeout')
    print('Mobile origin:',cfg['mobile']['origin']+'/')
    print('Wi-Fi bind:',str(address)+':54444','Test-only backend PID:',child.pid)
    print('CA profile prepared for manual owner installation; actual iPhone trust remains UNVERIFIED.')


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['prepare','refresh-network']);parser.parse_args();prepare()
