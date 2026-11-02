import 'package:erp_design/erp_design.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'auth/auth.dart';
import 'auth/login_screen.dart';
import 'gallery/gallery_screen.dart';
import 'shell/home_screen.dart';
import 'shell/theme_mode.dart';

void main() => runApp(const ProviderScope(child: GenuiErpApp()));

const _galleryEnabled = !kReleaseMode || bool.fromEnvironment('GALLERY');

class GenuiErpApp extends ConsumerWidget {
  const GenuiErpApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final mode = ref.watch(themeModeProvider);
    return MaterialApp(
      title: 'genui-erp',
      debugShowCheckedModeBanner: false,
      theme: buildErpTheme(Brightness.light),
      darkTheme: buildErpTheme(Brightness.dark),
      themeMode: mode,
      routes: {
        '/': (_) => const _Gate(),
        if (_galleryEnabled)
          '/gallery': (context) => GalleryScreen(
            onToggleTheme: () => ref.read(themeModeProvider.notifier).toggle(Theme.of(context).brightness),
          ),
      },
    );
  }
}

class _Gate extends ConsumerWidget {
  const _Gate();

  @override
  Widget build(BuildContext context, WidgetRef ref) =>
      ref.watch(authProvider.select((a) => a.session != null)) ? const HomeScreen() : const LoginScreen();
}
