import 'package:erp_design/erp_design.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config.dart';
import 'auth.dart';

const _demoAccounts = [
  ('Northfield Textiles', 'owner@northfield.test', 'Owner'),
  ('Northfield Textiles', 'salesrep@northfield.test', 'Sales rep'),
  ('Northfield Textiles', 'warehouse@northfield.test', 'Warehouse'),
  ('Northfield Textiles', 'accounts@northfield.test', 'Accounts'),
  ('Coastline Hardware', 'owner@coastline.test', 'Owner'),
  ('Coastline Hardware', 'salesrep@coastline.test', 'Sales rep'),
  ('Coastline Hardware', 'warehouse@coastline.test', 'Warehouse'),
  ('Coastline Hardware', 'accounts@coastline.test', 'Accounts'),
];

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  void _submit() => ref.read(authProvider.notifier).signIn(_email.text, _password.text);

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider);
    final t = context.type;
    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(Space.x4),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 400),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text('genui-erp', style: t.display),
              const SizedBox(height: Space.x1),
              Text('Sign in to ask questions about your orders, stock and invoices.', style: t.bodySecondary),
              const SizedBox(height: Space.x6),
              ErpSurface(
                padding: const EdgeInsets.all(Space.x6),
                child: AutofillGroup(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                    Text('Email', style: t.bodyStrong),
                    const SizedBox(height: Space.x1),
                    TextField(controller: _email, autofillHints: const [AutofillHints.email], keyboardType: TextInputType.emailAddress),
                    const SizedBox(height: Space.x4),
                    Text('Password', style: t.bodyStrong),
                    const SizedBox(height: Space.x1),
                    TextField(controller: _password, obscureText: true, autofillHints: const [AutofillHints.password], onSubmitted: (_) => _submit()),
                    const SizedBox(height: Space.x4),
                    if (auth.error != null) ...[
                      NoticeView(Notice.fromJson({'tone': 'danger', 'title': 'Could not sign in', 'body': auth.error})),
                      const SizedBox(height: Space.x4),
                    ],
                    ErpButton(label: 'Sign in', kind: ButtonKind.primary, busy: auth.busy, onPressed: _submit),
                  ]),
                ),
              ),
              if (showDemoAccounts) ...[
                const SizedBox(height: Space.x6),
                Text('Local demo accounts', style: t.bodyStrong),
                const SizedBox(height: Space.x1),
                Text('Password for all: genui-erp-local. For local use only.', style: t.caption),
                const SizedBox(height: Space.x2),
                for (final (tenant, email, role) in _demoAccounts)
                  _DemoAccount(tenant: tenant, email: email, role: role, onTap: () {
                    _email.text = email;
                    _password.text = 'genui-erp-local';
                    _submit();
                  }),
              ],
            ]),
          ),
        ),
      ),
    );
  }
}

class _DemoAccount extends StatelessWidget {
  const _DemoAccount({required this.tenant, required this.email, required this.role, required this.onTap});
  final String tenant;
  final String email;
  final String role;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final t = context.type;
    return Semantics(
      button: true,
      label: 'Sign in as $role at $tenant',
      child: InkWell(
        onTap: onTap,
        borderRadius: Radii.control,
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: Space.x2, horizontal: Space.x2),
          child: Row(children: [
            SizedBox(width: 90, child: Text(role, style: t.body)),
            Expanded(child: Text(tenant, style: t.bodySecondary)),
            Text(email, style: t.mono.copyWith(color: context.colors.textMuted)),
          ]),
        ),
      ),
    );
  }
}
