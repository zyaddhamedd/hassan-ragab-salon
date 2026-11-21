"""Offline target/credential guards; no database/server/application construction."""
import unittest
from unittest.mock import patch
import runtime


class RuntimeGuardTests(unittest.TestCase):
    def configuration(self):
        return dict(environment='omar-disposable-staff-integration',workspace=str(runtime.WORKSPACE),origin=runtime.ORIGIN,
            database=runtime.DATABASE,role=runtime.ROLE,port=55440,socket=str(runtime.PRIVATE/'socket'),data=str(runtime.PRIVATE/'data'),
            **{key:str(i)*64 for i,key in enumerate(('db_password','cluster_password','secret_key','jwt_secret'))})
    def test_operational_targets_and_noncanonical_paths_rejected_before_factory(self):
        for key,value in [('port',55432),('database','omar_fahim_local'),('role','omar_fahim_local'),
                ('socket','/tmp'),('data','/tmp'),('origin','http://localhost:54443'),('workspace','/tmp'),('environment','production')]:
            config=self.configuration();config[key]=value
            with self.subTest(key=key),patch.object(runtime,'engine') as engine:
                with self.assertRaises(RuntimeError):runtime.factory(config)
                engine.assert_not_called()
    def test_missing_or_reused_secrets_fail_closed(self):
        for value in ['',None,'password','a'*63]:
            cfg=self.configuration();cfg['db_password']=value
            with self.assertRaises(RuntimeError):runtime.validate(cfg)
        cfg=self.configuration();cfg['jwt_secret']=cfg['secret_key']
        with self.assertRaises(RuntimeError):runtime.validate(cfg)
    def test_exact_disposable_config_accepted_without_connections(self):
        with patch.object(runtime,'engine') as engine:runtime.validate(self.configuration());engine.assert_not_called()

    def test_mobile_origin_rejects_public_wildcard_and_unrelated_hosts(self):
        for ip in ['8.8.8.8','0.0.0.0','127.0.0.1','169.254.1.2','224.0.0.1']:
            cfg=self.configuration();cfg['mobile']=dict(bind_ip=ip,port=54444,hostname='staff-qa.local',origin='https://staff-qa.local:54444',subnet=ip+'/32')
            with self.subTest(ip=ip),self.assertRaises(RuntimeError):runtime.validate(cfg)
        cfg=self.configuration();cfg['mobile']=dict(bind_ip='192.168.100.39',port=54444,hostname='public.example.com',origin='https://public.example.com:54444',subnet='192.168.100.0/24')
        with self.assertRaises(RuntimeError):runtime.validate(cfg)
    def test_private_exact_mobile_origin_is_accepted(self):
        cfg=self.configuration();cfg['mobile']=dict(bind_ip='192.168.100.39',port=54444,hostname='staff-qa.local',origin='https://staff-qa.local:54444',subnet='192.168.100.0/24')
        runtime.validate(cfg)

    def test_field_activation_requires_explicit_owner_approval(self):
        import field
        with patch.object(runtime,'load') as load:
            with self.assertRaises(RuntimeError):field.prepare(False)
            load.assert_not_called()


if __name__=='__main__':unittest.main()
