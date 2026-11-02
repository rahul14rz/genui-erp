import 'package:flutter/widgets.dart';

/// Color tokens. Values follow the brief, except textMuted, which was
/// darkened (light) and lightened (dark) to pass WCAG AA on every background.
@immutable
final class ErpColors {
  const ErpColors({
    required this.bg,
    required this.surface,
    required this.surfaceSunken,
    required this.border,
    required this.borderStrong,
    required this.text,
    required this.textSecondary,
    required this.textMuted,
    required this.accent,
    required this.accentHover,
    required this.accentSubtle,
    required this.onAccent,
    required this.success,
    required this.successBg,
    required this.warning,
    required this.warningBg,
    required this.danger,
    required this.dangerBg,
  });

  final Color bg;
  final Color surface;
  final Color surfaceSunken;
  final Color border;
  final Color borderStrong;
  final Color text;
  final Color textSecondary;
  final Color textMuted;
  final Color accent;
  final Color accentHover;
  final Color accentSubtle;
  final Color onAccent;
  final Color success;
  final Color successBg;
  final Color warning;
  final Color warningBg;
  final Color danger;
  final Color dangerBg;

  static const light = ErpColors(
    bg: Color(0xFFFAFAF9),
    surface: Color(0xFFFFFFFF),
    surfaceSunken: Color(0xFFF5F5F4),
    border: Color(0xFFE7E5E4),
    borderStrong: Color(0xFFD6D3D1),
    text: Color(0xFF1C1917),
    textSecondary: Color(0xFF57534E),
    textMuted: Color(0xFF736C68),
    accent: Color(0xFF2B4C7E),
    accentHover: Color(0xFF223D66),
    accentSubtle: Color(0xFFEEF2F8),
    onAccent: Color(0xFFFFFFFF),
    success: Color(0xFF15803D),
    successBg: Color(0xFFF0FDF4),
    warning: Color(0xFFB45309),
    warningBg: Color(0xFFFFFBEB),
    danger: Color(0xFFB91C1C),
    dangerBg: Color(0xFFFEF2F2),
  );

  static const dark = ErpColors(
    bg: Color(0xFF0C0A09),
    surface: Color(0xFF1C1917),
    surfaceSunken: Color(0xFF151312),
    border: Color(0xFF292524),
    borderStrong: Color(0xFF3A3532),
    text: Color(0xFFF5F5F4),
    textSecondary: Color(0xFFA8A29E),
    textMuted: Color(0xFF908984),
    accent: Color(0xFF7FA3DB),
    accentHover: Color(0xFF9AB8E6),
    accentSubtle: Color(0xFF1A2433),
    onAccent: Color(0xFF0C0A09),
    success: Color(0xFF4ADE80),
    successBg: Color(0xFF0F1F15),
    warning: Color(0xFFFBBF24),
    warningBg: Color(0xFF221A0B),
    danger: Color(0xFFF87171),
    dangerBg: Color(0xFF2A1212),
  );

  /// Every text color paired with every background it is drawn on.
  Map<String, (Color, Color)> get textPairs => {
    for (final (fgName, fg) in [
      ('text', text),
      ('textSecondary', textSecondary),
      ('textMuted', textMuted),
      ('accent', accent),
    ])
      for (final (bgName, bgColor) in [
        ('bg', bg),
        ('surface', surface),
        ('surfaceSunken', surfaceSunken),
        ('accentSubtle', accentSubtle),
      ])
        '$fgName on $bgName': (fg, bgColor),
    'success on successBg': (success, successBg),
    'warning on warningBg': (warning, warningBg),
    'danger on dangerBg': (danger, dangerBg),
    'success on surface': (success, surface),
    'warning on surface': (warning, surface),
    'danger on surface': (danger, surface),
    'onAccent on accent': (onAccent, accent),
    'onAccent on accentHover': (onAccent, accentHover),
  };
}

/// The 4 pt spacing grid.
abstract final class Space {
  static const double x1 = 4;
  static const double x2 = 8;
  static const double x3 = 12;
  static const double x4 = 16;
  static const double x6 = 24;
  static const double x8 = 32;
  static const double x12 = 48;
}

abstract final class Radii {
  static const control = BorderRadius.all(Radius.circular(6));
  static const surface = BorderRadius.all(Radius.circular(10));
}

abstract final class Motion {
  static const duration = Duration(milliseconds: 160);
  static const curve = Curves.easeOut;

  /// Zero when the platform asks for reduced motion.
  static Duration of(BuildContext context) =>
      MediaQuery.maybeDisableAnimationsOf(context) ?? false ? Duration.zero : duration;
}

abstract final class Breakpoints {
  static const double phone = 600;
  static const double desktop = 1024;
  static const double column = 880;
}

/// The type scale. Numeric styles use tabular figures so columns line up.
@immutable
final class ErpType {
  const ErpType(this.color, this.secondary, this.muted);

  final Color color;
  final Color secondary;
  final Color muted;

  // Fonts declared by a package are registered under this prefix.
  static const sansFamily = 'packages/erp_design/IBMPlexSans';
  static const monoFamily = 'packages/erp_design/IBMPlexMono';
  static const _tabular = [FontFeature.tabularFigures()];

  TextStyle get display => TextStyle(
    fontFamily: sansFamily,
    fontSize: 28,
    height: 34 / 28,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.2,
    color: color,
  );
  TextStyle get title => TextStyle(
    fontFamily: sansFamily,
    fontSize: 20,
    height: 28 / 20,
    fontWeight: FontWeight.w600,
    letterSpacing: -0.2,
    color: color,
  );
  TextStyle get heading =>
      TextStyle(fontFamily: sansFamily, fontSize: 16, height: 24 / 16, fontWeight: FontWeight.w600, color: color);
  TextStyle get body =>
      TextStyle(fontFamily: sansFamily, fontSize: 14, height: 20 / 14, fontWeight: FontWeight.w400, color: color);
  TextStyle get bodySecondary => body.copyWith(color: secondary);
  TextStyle get bodyStrong =>
      TextStyle(fontFamily: sansFamily, fontSize: 14, height: 20 / 14, fontWeight: FontWeight.w500, color: color);
  TextStyle get caption =>
      TextStyle(fontFamily: sansFamily, fontSize: 12, height: 16 / 12, fontWeight: FontWeight.w400, color: muted);
  TextStyle get mono => TextStyle(
    fontFamily: monoFamily,
    fontSize: 13,
    height: 20 / 13,
    fontWeight: FontWeight.w400,
    color: color,
    fontFeatures: _tabular,
  );
  TextStyle get numeric => body.copyWith(fontFeatures: _tabular);
  TextStyle get kpi => title.copyWith(fontFeatures: _tabular);
  TextStyle get statusLabel => const TextStyle(
    fontFamily: sansFamily,
    fontSize: 11,
    height: 16 / 11,
    fontWeight: FontWeight.w500,
    letterSpacing: 0.4,
  );
}
