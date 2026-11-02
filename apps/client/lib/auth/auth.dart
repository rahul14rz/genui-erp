import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;

import '../config.dart';

final class AuthSession {
  const AuthSession({
    required this.token,
    required this.userName,
    required this.role,
    required this.tenantName,
    required this.currency,
  });

  final String token;
  final String userName;
  final String role;
  final String tenantName;
  final String currency;

  String get roleLabel => role.replaceAll('_', ' ');
}

final class AuthState {
  const AuthState({this.session, this.error, this.busy = false});
  final AuthSession? session;
  final String? error;
  final bool busy;
}

class AuthController extends Notifier<AuthState> {
  @override
  AuthState build() => const AuthState();

  Future<void> signIn(String email, String password) async {
    state = const AuthState(busy: true);
    try {
      final res = await http.post(
        Uri.parse('$apiUrl/auth/login'),
        headers: {'content-type': 'application/json'},
        body: jsonEncode({'email': email.trim(), 'password': password}),
      );
      final body = jsonDecode(res.body) as Map<String, Object?>;
      if (res.statusCode != 200) {
        final error = body['error'] as Map<String, Object?>?;
        state = AuthState(error: error?['message'] as String? ?? 'Sign-in failed.');
        return;
      }
      final user = body['user']! as Map<String, Object?>;
      final tenant = body['tenant']! as Map<String, Object?>;
      state = AuthState(
        session: AuthSession(
          token: body['token']! as String,
          userName: user['name']! as String,
          role: user['role']! as String,
          tenantName: tenant['name']! as String,
          currency: tenant['currency']! as String,
        ),
      );
    } on Object {
      state = const AuthState(error: 'The server could not be reached. Check that it is running on $apiUrl.');
    }
  }

  void signOut() => state = const AuthState();
}

final authProvider = NotifierProvider<AuthController, AuthState>(AuthController.new);
