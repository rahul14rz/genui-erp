import 'dart:math' as math;

import 'package:erp_design/erp_design.dart';
import 'package:flutter/painting.dart';
import 'package:flutter_test/flutter_test.dart';

double contrast(Color a, Color b) {
  final la = a.computeLuminance();
  final lb = b.computeLuminance();
  return (math.max(la, lb) + 0.05) / (math.min(la, lb) + 0.05);
}

void main() {
  for (final (name, colors) in [('light', ErpColors.light), ('dark', ErpColors.dark)]) {
    group('$name theme', () {
      for (final MapEntry(key: pair, value: (fg, bg)) in colors.textPairs.entries) {
        test('$pair meets WCAG AA for body text', () {
          expect(
            contrast(fg, bg),
            greaterThanOrEqualTo(4.5),
            reason: '$pair is ${contrast(fg, bg).toStringAsFixed(2)}:1',
          );
        });
      }
    });
  }

  test('the brief\'s original muted color fails, which is why it was changed', () {
    expect(contrast(const Color(0xFFA8A29E), ErpColors.light.surface), lessThan(4.5));
    expect(contrast(const Color(0xFF78716C), ErpColors.dark.surface), lessThan(4.5));
  });
}
