jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://signed.example/obj?sig=1'),
}))
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { MediaService } from './media.service'

describe('MediaService', () => {
  beforeEach(() => (getSignedUrl as jest.Mock).mockClear())

  it('presignPut gera key namespaced reports/<uuid>.<ext> e devolve url', async () => {
    const { url, key } = await new MediaService().presignPut('image/png')
    expect(url).toBe('https://signed.example/obj?sig=1')
    expect(key).toMatch(/^reports\/[0-9a-f-]{36}\.png$/)
    expect(getSignedUrl).toHaveBeenCalledTimes(1)
  })

  it('presignPut default jpg pra content-type não-png', async () => {
    const { key } = await new MediaService().presignPut('image/jpeg')
    expect(key).toMatch(/\.jpg$/)
  })

  it('presignGetMany assina cada key', async () => {
    const urls = await new MediaService().presignGetMany(['reports/a.jpg', 'reports/b.jpg'])
    expect(urls).toEqual(['https://signed.example/obj?sig=1', 'https://signed.example/obj?sig=1'])
    expect(getSignedUrl).toHaveBeenCalledTimes(2)
  })
})
