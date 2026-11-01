import 'dart:async';
import 'dart:io';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// Loads the bundled fonts and Material icons so goldens show real glyphs
/// instead of the test font's boxes.
Future<void> testExecutable(FutureOr<void> Function() testMain) async {
  TestWidgetsFlutterBinding.ensureInitialized();
  Future<void> load(String family, List<String> assets) async {
    final loader = FontLoader(family);
    for (final a in assets) {
      loader.addFont(rootBundle.load(a));
    }
    await loader.load();
  }

  await load('packages/erp_design/IBMPlexSans', [
    'fonts/IBMPlexSans-Regular.ttf',
    'fonts/IBMPlexSans-Medium.ttf',
    'fonts/IBMPlexSans-SemiBold.ttf',
  ]);
  await load('packages/erp_design/IBMPlexMono', ['fonts/IBMPlexMono-Regular.ttf', 'fonts/IBMPlexMono-Medium.ttf']);
  final icons = File('${Platform.environment['FLUTTER_ROOT']}/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf');
  if (icons.existsSync()) {
    final loader = FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(icons.readAsBytesSync())));
    await loader.load();
  }
  await testMain();
}
