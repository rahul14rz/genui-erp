import 'package:erp_design/erp_design.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import 'gallery/gallery_screen.dart';

void main() => runApp(const GenuiErpApp());

class GenuiErpApp extends StatefulWidget {
  const GenuiErpApp({super.key});

  @override
  State<GenuiErpApp> createState() => _GenuiErpAppState();
}

class _GenuiErpAppState extends State<GenuiErpApp> {
  ThemeMode _mode = ThemeMode.system;

  void _toggle() => setState(() {
        final dark = _mode == ThemeMode.dark ||
            (_mode == ThemeMode.system && MediaQuery.platformBrightnessOf(context) == Brightness.dark);
        _mode = dark ? ThemeMode.light : ThemeMode.dark;
      });

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'genui-erp',
        debugShowCheckedModeBanner: false,
        theme: buildErpTheme(Brightness.light),
        darkTheme: buildErpTheme(Brightness.dark),
        themeMode: _mode,
        initialRoute: '/',
        routes: {
          '/': (_) => const Scaffold(body: Center(child: Text('genui-erp'))),
          if (!kReleaseMode || const bool.fromEnvironment('GALLERY')) '/gallery': (_) => GalleryScreen(onToggleTheme: _toggle),
        },
      );
}
