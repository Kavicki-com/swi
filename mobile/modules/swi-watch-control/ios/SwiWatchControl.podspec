Pod::Spec.new do |s|
  s.name           = 'SwiWatchControl'
  s.version        = '0.1.0'
  s.summary        = 'Plano de controle do Apple Watch no SWI'
  s.description    = 'Recebe a HKWorkoutSession espelhada pelo Apple Watch e expoe estado e amostras ao JavaScript.'
  s.author         = 'Kavicki'
  s.homepage       = 'https://github.com/Kavicki-com/swi'
  s.license        = { :type => 'Proprietary' }
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.source         = { :git => 'https://github.com/Kavicki-com/swi.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'HealthKit', 'Security'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end
