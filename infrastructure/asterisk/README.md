# Asterisk node boundary

Asterisk provisioning begins in Phase 4 after SSH and canary provider details are supplied.

The approved node model is:

- Native Asterisk/PJSIP on Ubuntu
- Localhost-only ARI controlled by `apps/telephony-agent`
- Hardened `systemd` units with automatic restart and watchdogs
- Outbound-only mTLS connection to the App Platform central node API
- No customer-facing API, public ARI/AMI, Docker, or Portainer
- Local checksum-verified media synchronized from private Spaces
- Unique, revocable node identity and node-scoped provider configuration

Future Ansible roles and templates belong in this directory. Do not add real SIP, ARI,
enrollment, SSH, or Spaces credentials to the repository.
